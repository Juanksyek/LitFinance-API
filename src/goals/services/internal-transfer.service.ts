import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { randomBytes } from 'crypto';

import { Cuenta, CuentaDocument } from '../../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../../cuenta-historial/schemas/cuenta-historial.schema';
import { SubcuentaHistorial, SubcuentaHistorialDocument } from '../../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { ConversionService } from '../../utils/services/conversion.service';
import { InternalTransfer, InternalTransferDocument } from '../schemas/internal-transfer.schema';
import { generateUniqueId } from '../../utils/generate-id';

export type TransferEndpoint =
  | { type: 'cuenta'; id?: string; principal?: boolean }
  | { type: 'subcuenta'; id: string };

export type InternalTransferInput = {
  userId: string;
  monto: number;
  moneda?: string;
  origen: TransferEndpoint;
  destino: TransferEndpoint;
  motivo?: string;
  idempotencyKey?: string;
  conceptoId?: string | null;
  concepto?: string | null;
};

export type InternalTransferResult = {
  txId: string;
  montoOrigen: number;
  monedaOrigen: string;
  montoDestino: number;
  monedaDestino: string;
  tasaConversion: number | null;
  fechaConversion: Date | null;
  saldoOrigenDespues: number;
  saldoDestinoDespues: number;
  idempotent: boolean;
};

@Injectable()
export class InternalTransferService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(CuentaHistorial.name) private readonly cuentaHistorialModel: Model<CuentaHistorialDocument>,
    @InjectModel(SubcuentaHistorial.name) private readonly subcuentaHistorialModel: Model<SubcuentaHistorialDocument>,
    @InjectModel(InternalTransfer.name) private readonly transferModel: Model<InternalTransferDocument>,
    private readonly conversionService: ConversionService,
  ) {}

  private async resolveCuenta(userId: string, endpoint: TransferEndpoint): Promise<CuentaDocument> {
    if (endpoint.type !== 'cuenta') {
      throw new BadRequestException('Endpoint no es cuenta');
    }

    if (endpoint.principal || !endpoint.id) {
      const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');
      return cuenta as any;
    }

    const cuenta = await this.cuentaModel.findOne({ id: endpoint.id, userId });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');
    return cuenta as any;
  }

  private async resolveSubcuenta(userId: string, endpoint: TransferEndpoint): Promise<SubcuentaDocument> {
    if (endpoint.type !== 'subcuenta') {
      throw new BadRequestException('Endpoint no es subcuenta');
    }

    const sub = await this.subcuentaModel.findOne({ subCuentaId: endpoint.id, userId });
    if (!sub) throw new NotFoundException('Subcuenta no encontrada');
    return sub as any;
  }

  async transferir(input: InternalTransferInput): Promise<InternalTransferResult> {
    if (!input || !input.userId) throw new BadRequestException('userId requerido');
    if (!Number.isFinite(input.monto) || input.monto <= 0) throw new BadRequestException('monto inválido');

    const idempotencyKey = (input.idempotencyKey ?? '').trim() || null;

    // Fast path idempotente
    if (idempotencyKey) {
      const existing = await this.transferModel
        .findOne({ userId: input.userId, idempotencyKey })
        .lean();
      if (existing) {
        return {
          txId: existing.txId,
          montoOrigen: existing.montoOrigen,
          monedaOrigen: existing.monedaOrigen,
          montoDestino: existing.montoDestino,
          monedaDestino: existing.monedaDestino,
          tasaConversion: existing.tasaConversion ?? null,
          fechaConversion: existing.fechaConversion ?? null,
          saldoOrigenDespues: existing.saldoOrigenDespues,
          saldoDestinoDespues: existing.saldoDestinoDespues,
          idempotent: true,
        };
      }
    }

    const session = await this.connection.startSession();

    try {
      const result = await session.withTransaction(async () => {
        // Resolver origen/destino
        const origenIsCuenta = input.origen.type === 'cuenta';
        const destinoIsCuenta = input.destino.type === 'cuenta';

        const origenCuenta = origenIsCuenta ? await this.resolveCuenta(input.userId, input.origen) : null;
        const origenSub = !origenIsCuenta ? await this.resolveSubcuenta(input.userId, input.origen) : null;

        const destinoCuenta = destinoIsCuenta ? await this.resolveCuenta(input.userId, input.destino) : null;
        const destinoSub = !destinoIsCuenta ? await this.resolveSubcuenta(input.userId, input.destino) : null;

        const monedaOrigen = origenCuenta?.moneda ?? origenSub?.moneda;
        const monedaDestino = destinoCuenta?.moneda ?? destinoSub?.moneda;

        if (!monedaOrigen || !monedaDestino) {
          throw new BadRequestException('No se pudo resolver moneda de origen/destino');
        }

        // Regla MVP: el monto se interpreta en moneda del ORIGEN
        if (input.moneda && input.moneda !== monedaOrigen) {
          throw new BadRequestException('La moneda debe coincidir con la moneda del origen');
        }

        const montoOrigen = input.monto;

        // Conversión al destino si aplica
        let montoDestino = input.monto;
        let tasaConversion: number | null = null;
        let fechaConversion: Date | null = null;

        if (monedaDestino !== monedaOrigen) {
          const conv = await this.conversionService.convertir(input.monto, monedaOrigen, monedaDestino);
          montoDestino = conv.montoConvertido;
          tasaConversion = conv.tasaConversion;
          fechaConversion = conv.fechaConversion;
        }

        // Validar fondos origen
        const saldoOrigen = origenCuenta ? origenCuenta.cantidad : (origenSub as any).cantidad;
        if (saldoOrigen < montoOrigen) {
          throw new BadRequestException('Fondos insuficientes en el origen');
        }

        // Aplicar updates
        if (origenCuenta) {
          await this.cuentaModel.updateOne(
            { id: origenCuenta.id, userId: input.userId },
            { $inc: { cantidad: -montoOrigen } },
            { session },
          );
        } else {
          await this.subcuentaModel.updateOne(
            { subCuentaId: (origenSub as any).subCuentaId, userId: input.userId },
            { $inc: { cantidad: -montoOrigen } },
            { session },
          );
        }

        if (destinoCuenta) {
          await this.cuentaModel.updateOne(
            { id: destinoCuenta.id, userId: input.userId },
            { $inc: { cantidad: +montoDestino } },
            { session },
          );
        } else {
          await this.subcuentaModel.updateOne(
            { subCuentaId: (destinoSub as any).subCuentaId, userId: input.userId },
            { $inc: { cantidad: +montoDestino } },
            { session },
          );
        }

        // Releer saldos finales para respuesta
        const origenAfter = origenCuenta
          ? await this.cuentaModel.findOne({ id: origenCuenta.id, userId: input.userId }).session(session)
          : await this.subcuentaModel.findOne({ subCuentaId: (origenSub as any).subCuentaId, userId: input.userId }).session(session);

        const destinoAfter = destinoCuenta
          ? await this.cuentaModel.findOne({ id: destinoCuenta.id, userId: input.userId }).session(session)
          : await this.subcuentaModel.findOne({ subCuentaId: (destinoSub as any).subCuentaId, userId: input.userId }).session(session);

        if (!origenAfter || !destinoAfter) throw new BadRequestException('No se pudieron leer saldos finales');

        const saldoOrigenDespues = (origenAfter as any).cantidad;
        const saldoDestinoDespues = (destinoAfter as any).cantidad;

        // Generar txId
        const txId = await generateUniqueId(this.transferModel as any, 'txId');

        // Historiales (best-effort dentro de la misma transaction)
        const now = new Date();
        const desc = (input.motivo || 'Transferencia interna').slice(0, 180);

        // CuentaHistorial: usamos tipo ajuste_subcuenta (compat)
        if (origenCuenta) {
          await this.cuentaHistorialModel.create(
            [
              {
                id: randomBytes(6).toString('hex'),
                cuentaId: origenCuenta.id,
                userId: input.userId,
                monto: -montoOrigen,
                tipo: 'ajuste_subcuenta',
                descripcion: desc,
                fecha: now,
                subcuentaId: input.origen.type === 'subcuenta' ? input.origen.id : undefined,
                conceptoId: input.conceptoId ?? undefined,
                concepto: input.concepto ?? undefined,
                metadata: { txId, kind: 'transfer', side: 'origen', moneda: monedaOrigen },
              },
            ],
            { session },
          );
        }
        if (destinoCuenta) {
          await this.cuentaHistorialModel.create(
            [
              {
                id: randomBytes(6).toString('hex'),
                cuentaId: destinoCuenta.id,
                userId: input.userId,
                monto: +montoDestino,
                tipo: 'ajuste_subcuenta',
                descripcion: desc,
                fecha: now,
                subcuentaId: input.destino.type === 'subcuenta' ? input.destino.id : undefined,
                conceptoId: input.conceptoId ?? undefined,
                concepto: input.concepto ?? undefined,
                metadata: {
                  txId,
                  kind: 'transfer',
                  side: 'destino',
                  moneda: monedaDestino,
                  tasaConversion,
                  fechaConversion,
                },
              },
            ],
            { session },
          );
        }

        // SubcuentaHistorial (si aplica)
        if (origenSub) {
          await this.subcuentaHistorialModel.create(
            [
              {
                userId: input.userId,
                tipo: 'transferencia',
                descripcion: desc,
                subcuentaId: (origenSub as any)._id,
                conceptoId: input.conceptoId ?? undefined,
                concepto: input.concepto ?? undefined,
                datos: {
                  txId,
                  side: 'origen',
                  subCuentaId: (origenSub as any).subCuentaId,
                  monto: -montoOrigen,
                  moneda: monedaOrigen,
                },
              },
            ],
            { session },
          );
        }
        if (destinoSub) {
          await this.subcuentaHistorialModel.create(
            [
              {
                userId: input.userId,
                tipo: 'transferencia',
                descripcion: desc,
                subcuentaId: (destinoSub as any)._id,
                conceptoId: input.conceptoId ?? undefined,
                concepto: input.concepto ?? undefined,
                datos: {
                  txId,
                  side: 'destino',
                  subCuentaId: (destinoSub as any).subCuentaId,
                  monto: +montoDestino,
                  moneda: monedaDestino,
                  tasaConversion,
                  fechaConversion,
                },
              },
            ],
            { session },
          );
        }

        // Persistir InternalTransfer (para idempotencia y auditoría)
        await this.transferModel.create(
          [
            {
              userId: input.userId,
              txId,
              idempotencyKey,
              montoOrigen,
              monedaOrigen,
              montoDestino,
              monedaDestino,
              tasaConversion,
              fechaConversion,
              origenTipo: input.origen.type,
              origenId: input.origen.type === 'cuenta' ? (input.origen.id || 'principal') : input.origen.id,
              destinoTipo: input.destino.type,
              destinoId: input.destino.type === 'cuenta' ? (input.destino.id || 'principal') : input.destino.id,
              motivo: input.motivo ?? null,
              conceptoId: input.conceptoId ?? null,
              concepto: input.concepto ?? null,
              saldoOrigenDespues,
              saldoDestinoDespues,
            },
          ],
          { session },
        );

        return {
          txId,
          montoOrigen,
          monedaOrigen,
          montoDestino,
          monedaDestino,
          tasaConversion,
          fechaConversion,
          saldoOrigenDespues,
          saldoDestinoDespues,
          idempotent: false,
        };
      });

      return result as InternalTransferResult;
    } catch (e: any) {
      // Si hay choque por idempotencia, devolvemos el existente
      if (idempotencyKey && (e?.code === 11000 || String(e?.message ?? '').includes('E11000'))) {
        const existing = await this.transferModel
          .findOne({ userId: input.userId, idempotencyKey })
          .lean();
        if (existing) {
          return {
            txId: existing.txId,
            montoOrigen: existing.montoOrigen,
            monedaOrigen: existing.monedaOrigen,
            montoDestino: existing.montoDestino,
            monedaDestino: existing.monedaDestino,
            tasaConversion: existing.tasaConversion ?? null,
            fechaConversion: existing.fechaConversion ?? null,
            saldoOrigenDespues: existing.saldoOrigenDespues,
            saldoDestinoDespues: existing.saldoDestinoDespues,
            idempotent: true,
          };
        }
      }
      throw e;
    } finally {
      await session.endSession();
    }
  }
}
