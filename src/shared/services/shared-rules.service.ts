import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedSplitRule, SharedSplitRuleDocument } from '../schemas/shared-split-rule.schema';
import { SharedAuditService } from './shared-audit.service';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedRulesService {
  constructor(
    @InjectModel(SharedSplitRule.name)
    private readonly ruleModel: Model<SharedSplitRuleDocument>,
    private readonly auditService: SharedAuditService,
  ) {}

  async create(spaceId: string, dto: { nombre: string; tipo: string; scope?: string; config?: Record<string, any> }, actorUserId: string) {
    const ruleId = await generateUniqueId(this.ruleModel, 'ruleId');
    const rule = await this.ruleModel.create({
      ruleId,
      spaceId,
      nombre: dto.nombre,
      tipo: dto.tipo,
      scope: dto.scope ?? 'default',
      config: dto.config ?? {},
      estado: 'active',
      createdBy: actorUserId,
    });

    await this.auditService.log({
      spaceId,
      entityType: 'rule',
      entityId: ruleId,
      action: 'created',
      actorUserId,
      payloadAfter: { nombre: dto.nombre, tipo: dto.tipo },
    });

    return rule;
  }

  async list(spaceId: string) {
    return this.ruleModel.find({ spaceId, estado: 'active' }).sort({ createdAt: -1 }).lean();
  }

  async update(spaceId: string, ruleId: string, dto: { nombre?: string; tipo?: string; scope?: string; config?: Record<string, any> }, actorUserId: string) {
    const rule = await this.ruleModel.findOne({ ruleId, spaceId, estado: 'active' });
    if (!rule) throw new NotFoundException('Regla no encontrada');

    const before = { nombre: rule.nombre, tipo: rule.tipo, scope: rule.scope, config: rule.config };
    if (dto.nombre !== undefined) rule.nombre = dto.nombre;
    if (dto.tipo !== undefined) rule.tipo = dto.tipo;
    if (dto.scope !== undefined) rule.scope = dto.scope;
    if (dto.config !== undefined) rule.config = dto.config;
    await rule.save();

    await this.auditService.log({
      spaceId,
      entityType: 'rule',
      entityId: ruleId,
      action: 'updated',
      actorUserId,
      payloadBefore: before,
      payloadAfter: { nombre: rule.nombre, tipo: rule.tipo, scope: rule.scope },
    });

    return rule;
  }

  async archive(spaceId: string, ruleId: string, actorUserId: string) {
    const rule = await this.ruleModel.findOne({ ruleId, spaceId });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    rule.estado = 'archived';
    await rule.save();

    await this.auditService.log({
      spaceId,
      entityType: 'rule',
      entityId: ruleId,
      action: 'archived',
      actorUserId,
    });

    return { message: 'Regla archivada', ruleId };
  }

  async getById(ruleId: string) {
    return this.ruleModel.findOne({ ruleId }).lean();
  }
}
