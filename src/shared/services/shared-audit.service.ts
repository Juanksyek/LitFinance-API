import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedAuditLog, SharedAuditLogDocument } from '../schemas/shared-audit-log.schema';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedAuditService {
  constructor(
    @InjectModel(SharedAuditLog.name) private readonly auditModel: Model<SharedAuditLogDocument>,
  ) {}

  async log(params: {
    spaceId: string;
    movementId?: string;
    entityType: string;
    entityId: string;
    action: string;
    actorUserId: string;
    actorMemberId?: string;
    payloadBefore?: Record<string, any>;
    payloadAfter?: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const auditId = await generateUniqueId(this.auditModel, 'auditId');
    await this.auditModel.create({
      auditId,
      spaceId: params.spaceId,
      movementId: params.movementId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorUserId: params.actorUserId,
      actorMemberId: params.actorMemberId,
      payloadBefore: params.payloadBefore,
      payloadAfter: params.payloadAfter,
      metadata: params.metadata,
    });
  }

  async getBySpace(spaceId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.auditModel
        .find({ spaceId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.auditModel.countDocuments({ spaceId }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
