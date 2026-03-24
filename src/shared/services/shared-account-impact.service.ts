import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedAccountImpact, SharedAccountImpactDocument } from '../schemas/shared-account-impact.schema';
import { Cuenta, CuentaDocument } from '../../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../../cuenta-historial/schemas/cuenta-historial.schema';
import { SubcuentaHistorial, SubcuentaHistorialDocument } from '../../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { ConversionService } from '../../utils/services/conversion.service';
import { SharedAuditService } from './shared-audit.service';
import { SharedNotificationsService } from './shared-notifications.service';
import { generateUniqueId } from '../../utils/generate-id';
import { randomBytes } from 'crypto';

@Injectable()
export class SharedAccountImpactService {
  private readonly logger = new Logger(SharedAccountImpactService.name);

  constructor(
    @InjectModel(SharedAccountImpact.name) private readonly impactModel: Model<SharedAccountImpactDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(CuentaHistorial.name) private readonly cuentaHistorialModel: Model<CuentaHistorialDocument>,
    @InjectModel(SubcuentaHistorial.name) private readonly subcuentaHistorialModel: Model<SubcuentaHistorialDocument>,
    private readonly conversionService: ConversionService,
    private readonly auditService: SharedAuditService,
    private readonly notificationsService: SharedNotificationsService,
  ) {}

  async applyImpact(params: {
    movementId: string;
    spaceId: string;
    userId: string;
    memberId: string;
    destinationType: string;
    destinationId: string;
    impactType: string;
    amount: number;
    moneda: string;
    afectaSaldo?: boolean;
    movementTitle?: string;
    spaceName?: string;
  }): Promise<SharedAccountImpactDocument> {
    const {
      movementId, spaceId, userId, memberId,
      destinationType, destinationId, impactType,
      amount, moneda, afectaSaldo = true,
    } = params;

    // Verificar que la cuenta/subcuenta pertenezca al usuario
    let destMoneda: string;
    if (destinationType === 'main_account') {
      const cuenta = await this.cuentaModel.findOne({ id: destinationId, userId });
      if (!cuenta) throw new BadRequestException('Cuenta no encontrada o no pertenece al usuario');
      destMoneda = cuenta.moneda;
    } else {
      const sub = await this.subcuentaModel.findOne({ subCuentaId: destinationId, userId });
      if (!sub) throw new BadRequestException('Subcuenta no encontrada o no pertenece al usuario');
      destMoneda = sub.moneda;
    }

    // Conversión si monedas difieren
    let finalAmount = amount;
    let conversionMeta: any = null;
    if (moneda !== destMoneda) {
      const conv = await this.conversionService.convertir(amount, moneda, destMoneda);
      finalAmount = conv.montoConvertido;
      conversionMeta = {
        monedaOrigen: moneda,
        monedaDestino: destMoneda,
        tasaConversion: conv.tasaConversion,
        montoConvertido: conv.montoConvertido,
        fechaConversion: conv.fechaConversion,
      };
    }

    // Calcular signo según impactType
    const signo = impactType === 'income' ? 1 : impactType === 'expense' ? -1 : 0;
    const montoFirmado = signo * finalAmount;

    // Crear registro de impacto
    const impactId = await generateUniqueId(this.impactModel, 'impactId');
    const impact = await this.impactModel.create({
      impactId,
      movementId,
      spaceId,
      userId,
      memberId,
      destinationType,
      destinationId,
      impactType,
      amount: finalAmount,
      moneda: destMoneda,
      afectaSaldo,
      status: 'pending',
      conversionMeta,
    });

    if (!afectaSaldo) {
      impact.status = 'applied';
      impact.appliedAt = new Date();
      await impact.save();
      return impact;
    }

    try {
      // Aplicar saldo
      let historyId: string | undefined;

      if (destinationType === 'main_account') {
        // Validar fondos para egresos
        if (montoFirmado < 0) {
          const cuenta = await this.cuentaModel.findOne({ id: destinationId, userId });
          if (cuenta && cuenta.cantidad + montoFirmado < 0) {
            throw new BadRequestException(
              `Fondos insuficientes en la cuenta. Saldo: ${cuenta.cantidad}, monto: ${Math.abs(montoFirmado)}`,
            );
          }
        }

        await this.cuentaModel.updateOne(
          { id: destinationId, userId },
          { $inc: { cantidad: montoFirmado } },
        );

        historyId = randomBytes(6).toString('hex');
        await this.cuentaHistorialModel.create({
          id: historyId,
          cuentaId: destinationId,
          userId,
          monto: montoFirmado,
          tipo: impactType === 'income' ? 'ingreso' : impactType === 'expense' ? 'egreso' : 'ajuste',
          descripcion: `Espacio compartido: ${params.movementTitle ?? 'movimiento'}`,
          fecha: new Date(),
          metadata: {
            source: 'shared_space',
            spaceId,
            movementId,
            impactId,
            conversionMeta,
          },
        });
      } else {
        // Subcuenta
        if (montoFirmado < 0) {
          const sub = await this.subcuentaModel.findOne({ subCuentaId: destinationId, userId });
          if (sub && (sub as any).cantidad + montoFirmado < 0) {
            throw new BadRequestException(
              `Fondos insuficientes en la subcuenta. Saldo: ${(sub as any).cantidad}, monto: ${Math.abs(montoFirmado)}`,
            );
          }
        }

        await this.subcuentaModel.updateOne(
          { subCuentaId: destinationId, userId },
          { $inc: { cantidad: montoFirmado } },
        );

        await this.subcuentaHistorialModel.create({
          userId,
          tipo: 'modificacion',
          descripcion: `Espacio compartido: ${params.movementTitle ?? 'movimiento'}`,
          subcuentaId: destinationId,
          datos: {
            source: 'shared_space',
            spaceId,
            movementId,
            impactId,
            monto: montoFirmado,
            moneda: destMoneda,
            conversionMeta,
          },
        });
      }

      impact.status = 'applied';
      impact.appliedAt = new Date();
      if (historyId) impact.historyId = historyId;
      await impact.save();

      await this.notificationsService.create({
        userId,
        spaceId,
        type: 'impact_applied',
        title: 'Impacto aplicado',
        message: `Se aplicó un ${impactType} de ${finalAmount} ${destMoneda} en tu ${destinationType === 'main_account' ? 'cuenta principal' : 'subcuenta'}`,
        data: { impactId, movementId, amount: finalAmount, moneda: destMoneda },
      });

      this.logger.log(`Impacto ${impactId} aplicado: ${montoFirmado} ${destMoneda} → ${destinationType}:${destinationId}`);
    } catch (err) {
      impact.status = 'failed';
      impact.errorMessage = err.message;
      await impact.save();
      this.logger.error(`Impacto ${impactId} falló: ${err.message}`);
      throw err;
    }

    return impact;
  }

  async revertImpact(params: {
    impactId: string;
    spaceId: string;
    actorUserId: string;
    movementTitle?: string;
  }) {
    const impact = await this.impactModel.findOne({
      impactId: params.impactId,
      spaceId: params.spaceId,
      status: 'applied',
    });
    if (!impact) throw new NotFoundException('Impacto aplicado no encontrado');

    const signo = impact.impactType === 'income' ? -1 : impact.impactType === 'expense' ? 1 : 0;
    const montoReversa = signo * impact.amount;

    try {
      if (impact.destinationType === 'main_account') {
        await this.cuentaModel.updateOne(
          { id: impact.destinationId, userId: impact.userId },
          { $inc: { cantidad: montoReversa } },
        );

        const histId = randomBytes(6).toString('hex');
        await this.cuentaHistorialModel.create({
          id: histId,
          cuentaId: impact.destinationId,
          userId: impact.userId,
          monto: montoReversa,
          tipo: 'ajuste',
          descripcion: `Reversa espacio compartido: ${params.movementTitle ?? 'movimiento'}`,
          fecha: new Date(),
          metadata: {
            source: 'shared_space_revert',
            spaceId: params.spaceId,
            movementId: impact.movementId,
            impactId: params.impactId,
          },
        });
      } else {
        await this.subcuentaModel.updateOne(
          { subCuentaId: impact.destinationId, userId: impact.userId },
          { $inc: { cantidad: montoReversa } },
        );

        await this.subcuentaHistorialModel.create({
          userId: impact.userId,
          tipo: 'modificacion',
          descripcion: `Reversa espacio compartido: ${params.movementTitle ?? 'movimiento'}`,
          subcuentaId: impact.destinationId,
          datos: {
            source: 'shared_space_revert',
            spaceId: params.spaceId,
            movementId: impact.movementId,
            impactId: params.impactId,
            monto: montoReversa,
            moneda: impact.moneda,
          },
        });
      }

      impact.status = 'reverted';
      impact.revertedAt = new Date();
      await impact.save();

      await this.auditService.log({
        spaceId: params.spaceId,
        movementId: impact.movementId,
        entityType: 'impact',
        entityId: params.impactId,
        action: 'reverted',
        actorUserId: params.actorUserId,
        payloadBefore: { status: 'applied', amount: impact.amount },
        payloadAfter: { status: 'reverted' },
      });

      await this.notificationsService.create({
        userId: impact.userId,
        spaceId: params.spaceId,
        type: 'impact_reverted',
        title: 'Impacto revertido',
        message: `Se revirtió un impacto de ${impact.amount} ${impact.moneda} en tu ${impact.destinationType === 'main_account' ? 'cuenta principal' : 'subcuenta'}`,
        data: { impactId: params.impactId, movementId: impact.movementId },
        actorUserId: params.actorUserId,
      });

      return { message: 'Impacto revertido', impactId: params.impactId };
    } catch (err) {
      this.logger.error(`Error revirtiendo impacto ${params.impactId}: ${err.message}`);
      throw err;
    }
  }

  async revertAllForMovement(movementId: string, spaceId: string, actorUserId: string, movementTitle?: string) {
    const impacts = await this.impactModel.find({
      movementId,
      spaceId,
      status: 'applied',
    });

    const results: any[] = [];
    for (const impact of impacts) {
      try {
        const r = await this.revertImpact({
          impactId: impact.impactId,
          spaceId,
          actorUserId,
          movementTitle,
        });
        results.push(r);
      } catch (err) {
        results.push({ impactId: impact.impactId, error: err.message });
      }
    }
    return results;
  }

  async getByMovement(movementId: string) {
    return this.impactModel.find({ movementId }).sort({ createdAt: -1 }).lean();
  }

  async resyncImpact(params: {
    impactId: string;
    spaceId: string;
    newAmount: number;
    actorUserId: string;
    movementTitle?: string;
  }) {
    // Mark old impact as outdated, revert, and create new one
    const impact = await this.impactModel.findOne({
      impactId: params.impactId,
      spaceId: params.spaceId,
      status: 'applied',
    });
    if (!impact) throw new NotFoundException('Impacto aplicado no encontrado para resync');

    // Revert old
    await this.revertImpact({
      impactId: params.impactId,
      spaceId: params.spaceId,
      actorUserId: params.actorUserId,
      movementTitle: params.movementTitle,
    });

    // Mark as outdated instead of reverted
    await this.impactModel.updateOne(
      { impactId: params.impactId },
      { $set: { status: 'outdated' } },
    );

    // Apply new impact
    return this.applyImpact({
      movementId: impact.movementId,
      spaceId: params.spaceId,
      userId: impact.userId,
      memberId: impact.memberId,
      destinationType: impact.destinationType,
      destinationId: impact.destinationId,
      impactType: impact.impactType,
      amount: params.newAmount,
      moneda: impact.moneda,
      afectaSaldo: impact.afectaSaldo,
      movementTitle: params.movementTitle,
    });
  }
}
