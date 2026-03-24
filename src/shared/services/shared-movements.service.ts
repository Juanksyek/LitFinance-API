import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedMovement, SharedMovementDocument } from '../schemas/shared-movement.schema';
import { SharedMovementContribution, SharedMovementContributionDocument } from '../schemas/shared-movement-contribution.schema';
import { SharedMovementSplit, SharedMovementSplitDocument } from '../schemas/shared-movement-split.schema';
import { SharedSpace, SharedSpaceDocument } from '../schemas/shared-space.schema';
import { SharedSplitsService, SplitCalculationInput } from './shared-splits.service';
import { SharedMembersService } from './shared-members.service';
import { SharedAccountImpactService } from './shared-account-impact.service';
import { SharedAuditService } from './shared-audit.service';
import { SharedNotificationsService } from './shared-notifications.service';
import { CreateSharedMovementDto, UpdateSharedMovementDto } from '../dto/shared-movement.dto';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedMovementsService {
  private readonly logger = new Logger(SharedMovementsService.name);

  constructor(
    @InjectModel(SharedMovement.name) private readonly movementModel: Model<SharedMovementDocument>,
    @InjectModel(SharedMovementContribution.name) private readonly contributionModel: Model<SharedMovementContributionDocument>,
    @InjectModel(SharedMovementSplit.name) private readonly splitModel: Model<SharedMovementSplitDocument>,
    @InjectModel(SharedSpace.name) private readonly spaceModel: Model<SharedSpaceDocument>,
    private readonly splitsService: SharedSplitsService,
    private readonly membersService: SharedMembersService,
    private readonly accountImpactService: SharedAccountImpactService,
    private readonly auditService: SharedAuditService,
    private readonly notificationsService: SharedNotificationsService,
  ) {}

  async create(spaceId: string, userId: string, dto: CreateSharedMovementDto) {
    // Paso 1: Validar membresía
    const member = await this.membersService.requireActiveMember(spaceId, userId);
    const space = await this.spaceModel.findOne({ spaceId });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    if (space.estado === 'archivado') throw new BadRequestException('El espacio está archivado');

    // Idempotencia
    if (dto.idempotencyKey) {
      const existing = await this.movementModel.findOne({ spaceId, idempotencyKey: dto.idempotencyKey });
      if (existing) {
        const contributions = await this.contributionModel.find({ movementId: existing.movementId }).lean();
        const splits = await this.splitModel.find({ movementId: existing.movementId }).lean();
        return { movement: existing.toObject(), contributions, splits, idempotent: true };
      }
    }

    // Paso 2: Validar que los miembros de contributions y splits sean activos
    const memberMap = await this.membersService.getActiveMemberMap(spaceId);
    for (const c of dto.contributions) {
      if (!memberMap.has(c.memberId)) {
        throw new BadRequestException(`Contribuyente ${c.memberId} no es miembro activo del espacio`);
      }
    }
    for (const s of dto.splits) {
      if (!memberMap.has(s.memberId)) {
        throw new BadRequestException(`Miembro de split ${s.memberId} no es miembro activo del espacio`);
      }
    }

    // Paso 3: Validar consistencia
    this.splitsService.validateContributions(dto.montoTotal, dto.contributions);

    const splitMode = dto.splitMode ?? space.configuracion?.splitDefaultMode ?? 'equal';

    // Calcular splits
    const splitInput: SplitCalculationInput = {
      montoTotal: dto.montoTotal,
      splitMode,
      members: dto.splits.map((s) => ({
        memberId: s.memberId,
        userId: memberMap.get(s.memberId)!.userId,
        amountAssigned: s.amountAssigned,
        percentage: s.percentage,
        units: s.units,
        included: s.included,
      })),
    };

    let calculatedSplits;
    if (splitMode === 'equal' || splitMode === 'participants_only') {
      // Para igualitario, calcular automáticamente
      calculatedSplits = this.splitsService.calculate({
        montoTotal: dto.montoTotal,
        splitMode,
        members: dto.splits.map((s) => ({
          memberId: s.memberId,
          userId: memberMap.get(s.memberId)!.userId,
          included: s.included,
        })),
      });
    } else {
      calculatedSplits = this.splitsService.calculate(splitInput);
    }

    // Paso 4: Crear movimiento
    const movementId = await generateUniqueId(this.movementModel, 'movementId');
    const hasImpact = dto.accountImpact?.enabled === true;

    const movement = await this.movementModel.create({
      movementId,
      spaceId,
      createdByUserId: userId,
      createdByMemberId: member.memberId,
      tipo: dto.tipo,
      titulo: dto.titulo,
      descripcion: dto.descripcion ?? '',
      categoriaId: dto.categoriaId,
      montoTotal: dto.montoTotal,
      moneda: dto.moneda,
      fechaMovimiento: new Date(dto.fechaMovimiento),
      splitMode,
      visibility: dto.visibility ?? 'all',
      estado: 'published',
      notes: dto.notes,
      tags: dto.tags ?? [],
      linkedRuleId: dto.linkedRuleId,
      hasAccountImpact: hasImpact,
      idempotencyKey: dto.idempotencyKey,
    });

    // Paso 5: Crear contributions
    const contributions: any[] = [];
    for (const c of dto.contributions) {
      const cId = await generateUniqueId(this.contributionModel, 'contributionId');
      const memberData = memberMap.get(c.memberId)!;
      const contrib = await this.contributionModel.create({
        contributionId: cId,
        movementId,
        memberId: c.memberId,
        userId: memberData.userId,
        amountContributed: c.amountContributed,
        contributionType: c.contributionType ?? 'payer',
      });
      contributions.push(contrib.toObject());
    }

    // Paso 6: Crear splits
    const splits: any[] = [];
    for (const cs of calculatedSplits) {
      const sId = await generateUniqueId(this.splitModel, 'splitId');
      const sp = await this.splitModel.create({
        splitId: sId,
        movementId,
        memberId: cs.memberId,
        userId: cs.userId,
        included: cs.included,
        amountAssigned: cs.amountAssigned,
        percentage: cs.percentage,
        units: cs.units,
        roleInSplit: cs.roleInSplit ?? 'participant',
      });
      splits.push(sp.toObject());
    }

    // Paso 7: Account impact (si está habilitado)
    let impactResult: any = null;
    if (hasImpact && dto.accountImpact) {
      const ai = dto.accountImpact;
      if (!ai.destinationType || !ai.destinationId || !ai.impactType) {
        throw new BadRequestException('accountImpact requiere destinationType, destinationId e impactType');
      }

      try {
        impactResult = await this.accountImpactService.applyImpact({
          movementId,
          spaceId,
          userId,
          memberId: member.memberId,
          destinationType: ai.destinationType,
          destinationId: ai.destinationId,
          impactType: ai.impactType,
          amount: dto.montoTotal,
          moneda: dto.moneda,
          afectaSaldo: ai.afectaSaldo ?? true,
          movementTitle: dto.titulo,
          spaceName: space.nombre,
        });
      } catch (err) {
        this.logger.warn(`Account impact falló para movimiento ${movementId}: ${err.message}`);
        // El movimiento se creó OK, impacto falló
        impactResult = { status: 'failed', error: err.message };
      }
    }

    // Paso 8: Audit
    await this.auditService.log({
      spaceId,
      movementId,
      entityType: 'movement',
      entityId: movementId,
      action: 'created',
      actorUserId: userId,
      actorMemberId: member.memberId,
      payloadAfter: {
        tipo: dto.tipo,
        titulo: dto.titulo,
        montoTotal: dto.montoTotal,
        moneda: dto.moneda,
        splitMode,
        hasAccountImpact: hasImpact,
      },
    });

    // Paso 9: Notificar a miembros involucrados
    const involvedUserIds = new Set<string>();
    for (const s of calculatedSplits) {
      if (s.userId !== userId) involvedUserIds.add(s.userId);
    }
    for (const c of dto.contributions) {
      const md = memberMap.get(c.memberId);
      if (md && md.userId !== userId) involvedUserIds.add(md.userId);
    }

    if (involvedUserIds.size > 0) {
      await this.notificationsService.notifyMany([...involvedUserIds], {
        spaceId,
        type: 'movement_created',
        title: 'Nuevo movimiento compartido',
        message: `${dto.titulo}: ${dto.montoTotal} ${dto.moneda} en "${space.nombre}"`,
        data: { movementId, tipo: dto.tipo, montoTotal: dto.montoTotal, moneda: dto.moneda },
        actorUserId: userId,
      });
    }

    return {
      movement: movement.toObject(),
      contributions,
      splits,
      accountImpact: impactResult,
      idempotent: false,
    };
  }

  async list(spaceId: string, userId: string, query: {
    page?: number; limit?: number; search?: string; tipo?: string;
    estado?: string; categoryId?: string; from?: string; to?: string;
    createdBy?: string; hasAccountImpact?: string;
  }) {
    await this.membersService.requireActiveMember(spaceId, userId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const filter: any = { spaceId };
    if (query.tipo) filter.tipo = query.tipo;
    if (query.estado) filter.estado = query.estado;
    else filter.estado = { $ne: 'draft' };
    if (query.categoryId) filter.categoriaId = query.categoryId;
    if (query.createdBy) filter.createdByUserId = query.createdBy;
    if (query.hasAccountImpact === 'true') filter.hasAccountImpact = true;
    if (query.hasAccountImpact === 'false') filter.hasAccountImpact = false;
    if (query.search) filter.titulo = { $regex: query.search, $options: 'i' };
    if (query.from || query.to) {
      filter.fechaMovimiento = {};
      if (query.from) filter.fechaMovimiento.$gte = new Date(query.from);
      if (query.to) filter.fechaMovimiento.$lte = new Date(query.to);
    }

    const [items, total] = await Promise.all([
      this.movementModel.find(filter).sort({ fechaMovimiento: -1 }).skip(skip).limit(limit).lean(),
      this.movementModel.countDocuments(filter),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getDetail(spaceId: string, movementId: string, userId: string) {
    await this.membersService.requireActiveMember(spaceId, userId);

    const movement = await this.movementModel.findOne({ movementId, spaceId });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');

    const [contributions, splits, impacts] = await Promise.all([
      this.contributionModel.find({ movementId }).lean(),
      this.splitModel.find({ movementId }).lean(),
      this.accountImpactService.getByMovement(movementId),
    ]);

    // Calcular diferencias por miembro
    const memberDifferences = this.calculateDifferences(contributions, splits);

    return {
      movement: movement.toObject(),
      contributions,
      splits,
      impacts,
      memberDifferences,
    };
  }

  async update(spaceId: string, movementId: string, userId: string, dto: UpdateSharedMovementDto) {
    const member = await this.membersService.requireActiveMember(spaceId, userId);
    const movement = await this.movementModel.findOne({ movementId, spaceId });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    if (movement.estado === 'cancelled') throw new BadRequestException('No se puede editar un movimiento cancelado');

    const space = await this.spaceModel.findOne({ spaceId });
    if (space?.estado === 'archivado') throw new BadRequestException('El espacio está archivado');

    const before = {
      titulo: movement.titulo,
      descripcion: movement.descripcion,
      montoTotal: movement.montoTotal,
      categoriaId: movement.categoriaId,
      splitMode: movement.splitMode,
    };

    const montoChanged = dto.montoTotal !== undefined && dto.montoTotal !== movement.montoTotal;

    if (dto.titulo !== undefined) movement.titulo = dto.titulo;
    if (dto.descripcion !== undefined) movement.descripcion = dto.descripcion;
    if (dto.categoriaId !== undefined) movement.categoriaId = dto.categoriaId;
    if (dto.montoTotal !== undefined) movement.montoTotal = dto.montoTotal;
    if (dto.fechaMovimiento !== undefined) movement.fechaMovimiento = new Date(dto.fechaMovimiento);
    if (dto.notes !== undefined) movement.notes = dto.notes;
    if (dto.tags !== undefined) movement.tags = dto.tags;

    if (movement.estado === 'published') movement.estado = 'corrected';
    await movement.save();

    // Si se proporcionan nuevos contributions, reemplazar
    if (dto.contributions) {
      const memberMap = await this.membersService.getActiveMemberMap(spaceId);
      this.splitsService.validateContributions(movement.montoTotal, dto.contributions);

      await this.contributionModel.deleteMany({ movementId });
      for (const c of dto.contributions) {
        const cId = await generateUniqueId(this.contributionModel, 'contributionId');
        const md = memberMap.get(c.memberId);
        await this.contributionModel.create({
          contributionId: cId,
          movementId,
          memberId: c.memberId,
          userId: md?.userId ?? '',
          amountContributed: c.amountContributed,
          contributionType: c.contributionType ?? 'payer',
        });
      }
    }

    // Si se proporcionan nuevos splits, recalcular
    if (dto.splits) {
      const memberMap = await this.membersService.getActiveMemberMap(spaceId);
      const splitMode = dto.splitMode ?? movement.splitMode;

      const calculatedSplits = this.splitsService.calculate({
        montoTotal: movement.montoTotal,
        splitMode,
        members: dto.splits.map((s) => ({
          memberId: s.memberId,
          userId: memberMap.get(s.memberId)?.userId ?? '',
          amountAssigned: s.amountAssigned,
          percentage: s.percentage,
          units: s.units,
          included: s.included,
        })),
      });

      await this.splitModel.deleteMany({ movementId });
      for (const cs of calculatedSplits) {
        const sId = await generateUniqueId(this.splitModel, 'splitId');
        await this.splitModel.create({
          splitId: sId,
          movementId,
          memberId: cs.memberId,
          userId: cs.userId,
          included: cs.included,
          amountAssigned: cs.amountAssigned,
          percentage: cs.percentage,
          units: cs.units,
          roleInSplit: cs.roleInSplit,
        });
      }
    }

    // Si el monto cambió y hay impactos aplicados, resincronizar
    if (montoChanged && movement.hasAccountImpact) {
      const impacts = await this.accountImpactService.getByMovement(movementId);
      for (const imp of impacts) {
        if (imp.status === 'applied') {
          try {
            await this.accountImpactService.resyncImpact({
              impactId: imp.impactId,
              spaceId,
              newAmount: movement.montoTotal,
              actorUserId: userId,
              movementTitle: movement.titulo,
            });
          } catch (err) {
            this.logger.warn(`Resync de impacto ${imp.impactId} falló: ${err.message}`);
          }
        }
      }
    }

    await this.auditService.log({
      spaceId,
      movementId,
      entityType: 'movement',
      entityId: movementId,
      action: 'updated',
      actorUserId: userId,
      actorMemberId: member.memberId,
      payloadBefore: before,
      payloadAfter: {
        titulo: movement.titulo,
        montoTotal: movement.montoTotal,
        estado: movement.estado,
      },
    });

    // Notificar
    const activeUserIds = await this.membersService.getActiveUserIds(spaceId);
    const others = activeUserIds.filter((id) => id !== userId);
    if (others.length > 0) {
      await this.notificationsService.notifyMany(others, {
        spaceId,
        type: 'movement_edited',
        title: 'Movimiento editado',
        message: `"${movement.titulo}" fue editado en "${space?.nombre}"`,
        data: { movementId, titulo: movement.titulo, montoTotal: movement.montoTotal },
        actorUserId: userId,
      });
    }

    return movement.toObject();
  }

  async cancel(spaceId: string, movementId: string, userId: string) {
    await this.membersService.requireActiveMember(spaceId, userId);

    const movement = await this.movementModel.findOne({ movementId, spaceId });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    if (movement.estado === 'cancelled') throw new BadRequestException('El movimiento ya está cancelado');

    const space = await this.spaceModel.findOne({ spaceId });

    // Revertir impactos
    if (movement.hasAccountImpact) {
      await this.accountImpactService.revertAllForMovement(movementId, spaceId, userId, movement.titulo);
    }

    movement.estado = 'cancelled';
    movement.cancelledAt = new Date();
    movement.cancelledBy = userId;
    await movement.save();

    await this.auditService.log({
      spaceId,
      movementId,
      entityType: 'movement',
      entityId: movementId,
      action: 'cancelled',
      actorUserId: userId,
    });

    const activeUserIds = await this.membersService.getActiveUserIds(spaceId);
    const others = activeUserIds.filter((id) => id !== userId);
    if (others.length > 0) {
      await this.notificationsService.notifyMany(others, {
        spaceId,
        type: 'movement_cancelled',
        title: 'Movimiento cancelado',
        message: `"${movement.titulo}" fue cancelado en "${space?.nombre}"`,
        data: { movementId },
        actorUserId: userId,
      });
    }

    return { message: 'Movimiento cancelado', movementId };
  }

  async duplicate(spaceId: string, movementId: string, userId: string) {
    await this.membersService.requireActiveMember(spaceId, userId);

    const movement = await this.movementModel.findOne({ movementId, spaceId }).lean();
    if (!movement) throw new NotFoundException('Movimiento no encontrado');

    const contributions = await this.contributionModel.find({ movementId }).lean();
    const splits = await this.splitModel.find({ movementId }).lean();

    const dto: CreateSharedMovementDto = {
      tipo: movement.tipo,
      titulo: `${movement.titulo} (copia)`,
      descripcion: movement.descripcion,
      categoriaId: movement.categoriaId,
      montoTotal: movement.montoTotal,
      moneda: movement.moneda,
      fechaMovimiento: new Date().toISOString(),
      splitMode: movement.splitMode,
      visibility: movement.visibility,
      contributions: contributions.map((c) => ({
        memberId: c.memberId,
        amountContributed: c.amountContributed,
        contributionType: c.contributionType,
      })),
      splits: splits.map((s) => ({
        memberId: s.memberId,
        amountAssigned: s.amountAssigned,
        percentage: s.percentage,
        units: s.units,
        included: s.included,
        roleInSplit: s.roleInSplit,
      })),
      notes: movement.notes,
      tags: movement.tags,
    };

    return this.create(spaceId, userId, dto);
  }

  private calculateDifferences(
    contributions: any[],
    splits: any[],
  ): Array<{ memberId: string; userId: string; contributed: number; assigned: number; difference: number }> {
    const map = new Map<string, { contributed: number; assigned: number; userId: string }>();

    for (const c of contributions) {
      const entry = map.get(c.memberId) ?? { contributed: 0, assigned: 0, userId: c.userId };
      entry.contributed += c.amountContributed;
      map.set(c.memberId, entry);
    }

    for (const s of splits) {
      const entry = map.get(s.memberId) ?? { contributed: 0, assigned: 0, userId: s.userId };
      entry.assigned += s.amountAssigned;
      map.set(s.memberId, entry);
    }

    return Array.from(map.entries()).map(([memberId, data]) => ({
      memberId,
      userId: data.userId,
      contributed: +data.contributed.toFixed(2),
      assigned: +data.assigned.toFixed(2),
      difference: +(data.contributed - data.assigned).toFixed(2),
    }));
  }
}
