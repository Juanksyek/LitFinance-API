import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedSpaceMember, SharedSpaceMemberDocument } from '../schemas/shared-space-member.schema';
import { SharedAuditService } from './shared-audit.service';
import { SharedNotificationsService } from './shared-notifications.service';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedMembersService {
  constructor(
    @InjectModel(SharedSpaceMember.name)
    private readonly memberModel: Model<SharedSpaceMemberDocument>,
    private readonly auditService: SharedAuditService,
    private readonly notificationsService: SharedNotificationsService,
  ) {}

  async addMember(params: {
    spaceId: string;
    userId: string;
    rol: string;
    alias?: string;
    estado?: string;
    actorUserId: string;
    spaceName?: string;
  }): Promise<SharedSpaceMemberDocument> {
    const existing = await this.memberModel.findOne({
      spaceId: params.spaceId,
      userId: params.userId,
    });

    if (existing && existing.estado === 'active') {
      throw new BadRequestException('El usuario ya es miembro activo del espacio');
    }

    if (existing && (existing.estado === 'left' || existing.estado === 'removed')) {
      existing.estado = params.estado ?? 'active';
      existing.rol = params.rol ?? 'member';
      existing.alias = params.alias ?? existing.alias;
      existing.joinedAt = new Date();
      existing.leftAt = undefined as any;
      await existing.save();

      await this.auditService.log({
        spaceId: params.spaceId,
        entityType: 'member',
        entityId: existing.memberId,
        action: 'reactivated',
        actorUserId: params.actorUserId,
      });

      return existing;
    }

    const memberId = await generateUniqueId(this.memberModel, 'memberId');
    const member = await this.memberModel.create({
      memberId,
      spaceId: params.spaceId,
      userId: params.userId,
      rol: params.rol ?? 'member',
      alias: params.alias ?? '',
      estado: params.estado ?? 'active',
      joinedAt: params.estado === 'active' ? new Date() : undefined,
    });

    await this.auditService.log({
      spaceId: params.spaceId,
      entityType: 'member',
      entityId: memberId,
      action: 'added',
      actorUserId: params.actorUserId,
      payloadAfter: { userId: params.userId, rol: params.rol },
    });

    return member;
  }

  async listMembers(spaceId: string, includeInactive = false) {
    const filter: any = { spaceId };
    if (!includeInactive) {
      filter.estado = { $in: ['active', 'invited'] };
    }

    // Devolver members junto con nombreCompleto del usuario para evitar llamadas adicionales desde el frontend
    // Usamos aggregate + $lookup a la colección 'users' (user.id) y proyectamos nombreCompleto
    const pipeline: any[] = [
      { $match: filter },
      { $sort: { joinedAt: 1 } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          memberId: 1,
          spaceId: 1,
          userId: 1,
          rol: 1,
          alias: 1,
          estado: 1,
          joinedAt: 1,
          leftAt: 1,
          permissionsOverride: 1,
          nombreCompleto: '$user.nombreCompleto',
        },
      },
    ];

    return this.memberModel.aggregate(pipeline).exec();
  }

  async findMember(spaceId: string, userId: string): Promise<SharedSpaceMemberDocument | null> {
    return this.memberModel.findOne({ spaceId, userId });
  }

  async findMemberById(memberId: string): Promise<SharedSpaceMemberDocument | null> {
    return this.memberModel.findOne({ memberId });
  }

  async requireActiveMember(spaceId: string, userId: string): Promise<SharedSpaceMemberDocument> {
    const member = await this.memberModel.findOne({ spaceId, userId, estado: 'active' });
    if (!member) {
      throw new ForbiddenException('No eres miembro activo de este espacio');
    }
    return member;
  }

  async requireRole(spaceId: string, userId: string, roles: string[]): Promise<SharedSpaceMemberDocument> {
    const member = await this.requireActiveMember(spaceId, userId);
    if (!roles.includes(member.rol)) {
      throw new ForbiddenException(`Se requiere rol: ${roles.join(' o ')}`);
    }
    return member;
  }

  async changeRole(params: {
    spaceId: string;
    memberId: string;
    newRole: string;
    actorUserId: string;
    spaceName?: string;
  }) {
    const member = await this.memberModel.findOne({ memberId: params.memberId, spaceId: params.spaceId });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    if (member.rol === 'owner') throw new BadRequestException('No se puede cambiar el rol del propietario');

    const oldRole = member.rol;
    member.rol = params.newRole;
    await member.save();

    await this.auditService.log({
      spaceId: params.spaceId,
      entityType: 'member',
      entityId: params.memberId,
      action: 'role_changed',
      actorUserId: params.actorUserId,
      payloadBefore: { rol: oldRole },
      payloadAfter: { rol: params.newRole },
    });

    await this.notificationsService.create({
      userId: member.userId,
      spaceId: params.spaceId,
      type: 'role_changed',
      title: 'Cambio de rol',
      message: `Tu rol en "${params.spaceName ?? 'espacio compartido'}" cambió de ${oldRole} a ${params.newRole}`,
      data: { memberId: params.memberId, oldRole, newRole: params.newRole },
      actorUserId: params.actorUserId,
    });

    return member;
  }

  async removeMember(params: {
    spaceId: string;
    memberId: string;
    actorUserId: string;
    spaceName?: string;
  }) {
    const member = await this.memberModel.findOne({ memberId: params.memberId, spaceId: params.spaceId });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    if (member.rol === 'owner') throw new BadRequestException('No se puede remover al propietario');

    member.estado = 'removed';
    member.leftAt = new Date();
    await member.save();

    await this.auditService.log({
      spaceId: params.spaceId,
      entityType: 'member',
      entityId: params.memberId,
      action: 'removed',
      actorUserId: params.actorUserId,
    });

    await this.notificationsService.create({
      userId: member.userId,
      spaceId: params.spaceId,
      type: 'member_removed',
      title: 'Removido del espacio',
      message: `Has sido removido del espacio "${params.spaceName ?? 'compartido'}"`,
      data: { memberId: params.memberId },
      actorUserId: params.actorUserId,
    });

    return { message: 'Miembro removido', memberId: params.memberId };
  }

  async leaveSpace(params: {
    spaceId: string;
    userId: string;
    spaceName?: string;
  }) {
    const member = await this.memberModel.findOne({ spaceId: params.spaceId, userId: params.userId, estado: 'active' });
    if (!member) throw new NotFoundException('No eres miembro activo de este espacio');
    if (member.rol === 'owner') throw new BadRequestException('El propietario no puede abandonar el espacio. Transfiérelo primero.');

    member.estado = 'left';
    member.leftAt = new Date();
    await member.save();

    await this.auditService.log({
      spaceId: params.spaceId,
      entityType: 'member',
      entityId: member.memberId,
      action: 'left',
      actorUserId: params.userId,
    });

    const activeMembers = await this.memberModel.find({
      spaceId: params.spaceId,
      estado: 'active',
      userId: { $ne: params.userId },
    }).lean();

    await this.notificationsService.notifyMany(
      activeMembers.map((m) => m.userId),
      {
        spaceId: params.spaceId,
        type: 'member_left',
        title: 'Miembro salió',
        message: `Un miembro abandonó el espacio "${params.spaceName ?? 'compartido'}"`,
        data: { memberId: member.memberId, userId: params.userId },
        actorUserId: params.userId,
      },
    );

    return { message: 'Has abandonado el espacio' };
  }

  async getActiveUserIds(spaceId: string): Promise<string[]> {
    const members = await this.memberModel
      .find({ spaceId, estado: 'active' })
      .select('userId')
      .lean();
    return members.map((m) => m.userId);
  }

  async getActiveMemberMap(spaceId: string): Promise<Map<string, any>> {
    const members = await this.memberModel
      .find({ spaceId, estado: 'active' })
      .lean();
    const map = new Map<string, any>();
    for (const m of members) {
      map.set(m.memberId, m);
    }
    return map;
  }

  async listMemberspacesForUser(userId: string): Promise<{ spaceId: string }[]> {
    const memberships = await this.memberModel
      .find({ userId, estado: 'active' })
      .select('spaceId')
      .lean();
    return memberships.map((m) => ({ spaceId: m.spaceId }));
  }

  async countActiveMembers(spaceId: string): Promise<number> {
    return this.memberModel.countDocuments({ spaceId, estado: 'active' });
  }
}
