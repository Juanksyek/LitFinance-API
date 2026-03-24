import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes, createHash } from 'crypto';
import { SharedInvitation, SharedInvitationDocument } from '../schemas/shared-invitation.schema';
import { SharedSpace, SharedSpaceDocument } from '../schemas/shared-space.schema';
import { SharedSpaceMember, SharedSpaceMemberDocument } from '../schemas/shared-space-member.schema';
import { SharedMembersService } from './shared-members.service';
import { SharedAuditService } from './shared-audit.service';
import { SharedNotificationsService } from './shared-notifications.service';
import { EmailService } from '../../email/email.service';
import { generateUniqueId } from '../../utils/generate-id';
import { User, UserDocument } from '../../user/schemas/user.schema/user.schema';

@Injectable()
export class SharedInvitationsService {
  constructor(
    @InjectModel(SharedInvitation.name)
    private readonly invitationModel: Model<SharedInvitationDocument>,
    @InjectModel(SharedSpace.name)
    private readonly spaceModel: Model<SharedSpaceDocument>,
    @InjectModel(SharedSpaceMember.name)
    private readonly memberModel: Model<SharedSpaceMemberDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly membersService: SharedMembersService,
    private readonly auditService: SharedAuditService,
    private readonly notificationsService: SharedNotificationsService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildShareUrl(token: string): string {
    const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://app.thelitfinance.com';
    return `${frontendUrl}/invite?token=${encodeURIComponent(token)}`;
  }

  private buildDeepLink(token: string): string {
    const scheme = process.env.APP_SCHEME || 'litfinance';
    return `${scheme}://invite?token=${encodeURIComponent(token)}`;
  }

  private resolveInvitationType(dto: { invitedUserId?: string; email?: string; invitationType?: string }): string {
    if (dto.invitationType) return dto.invitationType;
    if (dto.invitedUserId) return 'direct';
    if (dto.email) return 'email';
    return 'link';
  }

  // ─── Crear invitación ────────────────────────────────────────

  async createInvitation(
    spaceId: string,
    actorUserId: string,
    dto: {
      invitedUserId?: string;
      email?: string;
      rol?: string;
      message?: string;
      invitationType?: string;
      multiUse?: boolean;
    },
  ) {
    await this.membersService.requireRole(spaceId, actorUserId, ['owner', 'admin']);

    const space = await this.spaceModel.findOne({ spaceId });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    if (space.estado === 'archivado') throw new BadRequestException('El espacio está archivado');

    const invitationType = this.resolveInvitationType(dto);

    // Resolver usuario invitado
    let targetUserId = dto.invitedUserId;
    let targetEmail = dto.email;

    if (!targetUserId && targetEmail) {
      const user = await this.userModel.findOne({ email: targetEmail }).select('id email');
      if (user) targetUserId = (user as any).id;
    }

    // Para direct y email necesitamos al menos uno de los dos
    if (invitationType !== 'link' && !targetUserId && !targetEmail) {
      throw new BadRequestException('Debe proporcionar invitedUserId o email para invitaciones directas/email');
    }

    // Verificar si ya es miembro activo
    if (targetUserId) {
      const existing = await this.memberModel.findOne({
        spaceId,
        userId: targetUserId,
        estado: 'active',
      });
      if (existing) throw new BadRequestException('El usuario ya es miembro activo del espacio');
    }

    // Verificar invitación pendiente duplicada (solo para direct/email, no para link)
    if (invitationType !== 'link') {
      const pendingFilter: any = { spaceId, estado: 'pending' };
      if (targetUserId) pendingFilter.invitedUserId = targetUserId;
      else pendingFilter.email = targetEmail;

      const pendingExists = await this.invitationModel.findOne(pendingFilter);
      if (pendingExists) throw new BadRequestException('Ya existe una invitación pendiente para este usuario');
    }

    // Verificar límite de miembros
    const activeCount = await this.memberModel.countDocuments({ spaceId, estado: 'active' });
    const maxMembers = space.configuracion?.maxMembers ?? 20;
    if (activeCount >= maxMembers) {
      throw new BadRequestException(`El espacio ha alcanzado el límite de ${maxMembers} miembros`);
    }

    const invitationId = await generateUniqueId(this.invitationModel, 'invitationId');
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const shareUrl = this.buildShareUrl(token);
    const deepLink = this.buildDeepLink(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

    const isLink = invitationType === 'link';

    const invitation = await this.invitationModel.create({
      invitationId,
      spaceId,
      createdBy: actorUserId,
      // Para links: nunca fijar invitedUserId/email en creación
      invitedUserId: isLink ? undefined : (targetUserId || undefined),
      email: isLink ? undefined : (targetEmail || undefined),
      invitationType,
      token,
      tokenHash,
      shareUrl,
      rol: dto.rol || 'member',
      message: dto.message || undefined,
      multiUse: isLink ? (dto.multiUse ?? false) : false,
      maxUses: isLink ? ((dto as any).maxUses ?? 0) : 0,
      acceptedCount: 0,
      estado: 'pending',
      expiresAt,
    });

    await this.auditService.log({
      spaceId,
      entityType: 'invitation',
      entityId: invitationId,
      action: 'created',
      actorUserId,
      payloadAfter: { invitedUserId: targetUserId, email: targetEmail, invitationType },
    });

    // ─── Notificación in-app para invitaciones directas ────────
    if (targetUserId && (invitationType === 'direct' || invitationType === 'email')) {
      await this.notificationsService.create({
        userId: targetUserId,
        spaceId,
        type: 'invitation_received',
        title: 'Invitación a espacio compartido',
        message: `Te han invitado al espacio "${space.nombre}"`,
        data: { invitationId, spaceId, spaceName: space.nombre, shareUrl },
        actorUserId,
      });
    }

    // ─── Envío de correo para invitaciones tipo email ──────────
    if (invitationType === 'email' && targetEmail) {
      const inviterUser = await this.userModel.findOne({ id: actorUserId }).select('nombreCompleto email');
      const inviterName = (inviterUser as any)?.nombreCompleto || 'Un usuario';

      await this.emailService.sendSpaceInvitationEmail(targetEmail, {
        inviterName,
        spaceName: space.nombre,
        shareUrl,
        deepLink,
        message: dto.message,
        expiresAt,
      });
    }

    return {
      invitationId: invitation.invitationId,
      spaceId: invitation.spaceId,
      invitationType,
      estado: invitation.estado,
      shareUrl,
      deepLink,
      expiresAt: invitation.expiresAt,
      multiUse: invitation.multiUse,
      ...(targetEmail && { email: targetEmail }),
      ...(targetUserId && { invitedUserId: targetUserId }),
    };
  }

  // ─── Listar invitaciones del espacio ─────────────────────────

  async listBySpace(spaceId: string) {
    return this.invitationModel.find({ spaceId }).sort({ createdAt: -1 }).lean();
  }

  // ─── Invitaciones pendientes del usuario actual ──────────────

  async listPendingForUser(userId: string) {
    const user = await this.userModel.findOne({ id: userId }).select('email');
    const filter: any = {
      estado: 'pending',
      expiresAt: { $gt: new Date() },
      $or: [{ invitedUserId: userId }],
    };
    if (user?.email) {
      filter.$or.push({ email: user.email });
    }

    const invitations = await this.invitationModel.find(filter).sort({ createdAt: -1 }).lean();

    const spaceIds = [...new Set(invitations.map((i) => i.spaceId))];
    const spaces = await this.spaceModel.find({ spaceId: { $in: spaceIds } }).select('spaceId nombre').lean();
    const spaceMap = new Map(spaces.map((s) => [s.spaceId, s.nombre]));

    return invitations.map((inv) => ({
      ...inv,
      spaceName: spaceMap.get(inv.spaceId) ?? 'Espacio',
    }));
  }

  // ─── Verificar token (público, sin aceptar) ─────────────────

  async verifyToken(token: string) {
    const invitation = await this.invitationModel
      .findOne({ token })
      .select('invitationId spaceId invitationType estado expiresAt multiUse maxUses acceptedCount message rol createdBy')
      .lean();

    if (!invitation) throw new NotFoundException('Invitación no encontrada');

    const isExpired = new Date(invitation.expiresAt) < new Date();
    if (isExpired && invitation.estado === 'pending') {
      await this.invitationModel.updateOne({ token }, { estado: 'expired' });
    }

    const space = await this.spaceModel
      .findOne({ spaceId: invitation.spaceId })
      .select('spaceId nombre tipo monedaBase')
      .lean();

    const inviter = await this.userModel
      .findOne({ id: invitation.createdBy })
      .select('nombreCompleto')
      .lean();

    const capReached =
      invitation.multiUse &&
      (invitation as any).maxUses > 0 &&
      ((invitation as any).acceptedCount ?? 0) >= (invitation as any).maxUses;

    const remainingUses =
      invitation.multiUse && (invitation as any).maxUses > 0
        ? Math.max(0, (invitation as any).maxUses - ((invitation as any).acceptedCount ?? 0))
        : null;

    return {
      valid: invitation.estado === 'pending' && !isExpired && !capReached,
      invitationId: invitation.invitationId,
      estado: isExpired ? 'expired' : invitation.estado,
      invitationType: invitation.invitationType,
      rol: invitation.rol,
      message: invitation.message ?? null,
      multiUse: invitation.multiUse,
      maxUses: (invitation as any).maxUses > 0 ? (invitation as any).maxUses : null,
      acceptedCount: (invitation as any).acceptedCount ?? 0,
      remainingUses,
      expiresAt: invitation.expiresAt,
      space: space
        ? { spaceId: space.spaceId, nombre: space.nombre, tipo: space.tipo, monedaBase: space.monedaBase }
        : null,
      invitedBy: (inviter as any)?.nombreCompleto ?? null,
    };
  }

  // ─── Aceptar invitación por token ────────────────────────────

  async acceptByToken(token: string, userId: string) {
    // Lectura inicial para validaciones previas al update atómico
    const invitation = await this.invitationModel.findOne({ token });
    if (!invitation) throw new NotFoundException('Invitación no encontrada o ya no está vigente');

    // Expiración
    if (invitation.expiresAt < new Date()) {
      if (invitation.estado === 'pending') {
        await this.invitationModel.updateOne({ token }, { estado: 'expired' });
      }
      throw new BadRequestException('La invitación ha expirado');
    }

    // Estado inválido
    if (invitation.estado !== 'pending') {
      throw new BadRequestException(
        invitation.estado === 'accepted'
          ? 'Esta invitación ya fue utilizada'
          : `La invitación fue ${invitation.estado}`,
      );
    }

    // Cap para links multiUse: si maxUses > 0 y ya se alcanzó, rechazar
    if (invitation.multiUse && invitation.maxUses > 0 && invitation.acceptedCount >= invitation.maxUses) {
      throw new BadRequestException(`Este link de invitación alcanzó el límite de ${invitation.maxUses} usos`);
    }

    // Verificar que el usuario sea el correcto (solo para direct/email)
    if (invitation.invitationType !== 'link') {
      if (invitation.invitedUserId && invitation.invitedUserId !== userId) {
        const user = await this.userModel.findOne({ id: userId }).select('email');
        if (!user?.email || user.email !== invitation.email) {
          throw new BadRequestException('Esta invitación no es para ti');
        }
      }
    }

    // Verificar que no sea ya miembro activo
    const alreadyMember = await this.memberModel.findOne({
      spaceId: invitation.spaceId,
      userId,
      estado: 'active',
    });
    if (alreadyMember) throw new BadRequestException('Ya eres miembro activo de este espacio');

    // Verificar límite de miembros del espacio
    const space = await this.spaceModel.findOne({ spaceId: invitation.spaceId });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    if (space.estado === 'archivado') throw new BadRequestException('El espacio está archivado');

    const activeCount = await this.memberModel.countDocuments({ spaceId: invitation.spaceId, estado: 'active' });
    const maxMembers = space.configuracion?.maxMembers ?? 20;
    if (activeCount >= maxMembers) {
      throw new BadRequestException(`El espacio ha alcanzado el límite de ${maxMembers} miembros`);
    }

    // ─── Actualización atómica ────────────────────────────────
    // Para link multiUse: incrementar acceptedCount, mantener estado pending, NO tocar invitedUserId
    // Para link single-use y direct/email: marcar accepted, guardar invitedUserId si faltaba
    const isLinkType = invitation.invitationType === 'link';

    if (invitation.multiUse) {
      // Incremento atómico para evitar race conditions
      const updated = await this.invitationModel.findOneAndUpdate(
        {
          token,
          estado: 'pending',
          // Re-verificar cap en el update atómico
          $or: [
            { maxUses: { $lte: 0 } },
            { $expr: { $lt: ['$acceptedCount', '$maxUses'] } },
          ],
        },
        {
          $inc: { acceptedCount: 1 },
          $set: { acceptedAt: new Date() },
        },
        { new: true },
      );
      if (!updated) {
        throw new BadRequestException('Este link de invitación ya no está disponible (límite alcanzado o revocado)');
      }
    } else {
      // Single-use: marcar accepted atómicamente
      const updateFields: any = { estado: 'accepted', acceptedAt: new Date() };
      if (!isLinkType && !invitation.invitedUserId) {
        updateFields.invitedUserId = userId;
      }
      const updated = await this.invitationModel.findOneAndUpdate(
        { token, estado: 'pending' },
        { $set: updateFields },
        { new: true },
      );
      if (!updated) {
        throw new BadRequestException('Esta invitación ya fue utilizada por otro usuario');
      }
    }

    // Crear membership
    await this.membersService.addMember({
      spaceId: invitation.spaceId,
      userId,
      rol: invitation.rol || 'member',
      estado: 'active',
      actorUserId: userId,
      spaceName: space.nombre,
    });

    await this.auditService.log({
      spaceId: invitation.spaceId,
      entityType: 'invitation',
      entityId: invitation.invitationId,
      action: 'accepted',
      actorUserId: userId,
      payloadAfter: { invitationType: invitation.invitationType, multiUse: invitation.multiUse },
    });

    // Notificar al que invitó
    await this.notificationsService.create({
      userId: invitation.createdBy,
      spaceId: invitation.spaceId,
      type: 'invitation_accepted',
      title: 'Invitación aceptada',
      message: `Tu invitación al espacio "${space.nombre}" fue aceptada`,
      data: { invitationId: invitation.invitationId, acceptedBy: userId },
      actorUserId: userId,
    });

    // Notificar a todos los miembros activos (excepto el que acepta y el invitador)
    const activeMembers = await this.membersService.getActiveUserIds(invitation.spaceId);
    const otherMembers = activeMembers.filter((id) => id !== userId && id !== invitation.createdBy);
    if (otherMembers.length > 0) {
      await this.notificationsService.notifyMany(otherMembers, {
        spaceId: invitation.spaceId,
        type: 'member_joined',
        title: 'Nuevo miembro',
        message: `Un nuevo miembro se unió al espacio "${space.nombre}"`,
        data: { userId },
        actorUserId: userId,
      });
    }

    return {
      message: 'Invitación aceptada. Ahora eres miembro del espacio.',
      spaceId: invitation.spaceId,
      spaceName: space.nombre,
    };
  }

  // ─── Aceptar por invitationId (legacy, para in-app) ─────────

  async accept(invitationId: string, userId: string) {
    const invitation = await this.invitationModel.findOne({ invitationId, estado: 'pending' });
    if (!invitation) throw new NotFoundException('Invitación no encontrada o ya no está vigente');
    return this.acceptByToken(invitation.token, userId);
  }

  // ─── Rechazar ────────────────────────────────────────────────

  async reject(invitationId: string, userId: string) {
    const invitation = await this.invitationModel.findOne({ invitationId, estado: 'pending' });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');

    invitation.estado = 'rejected';
    await invitation.save();

    await this.auditService.log({
      spaceId: invitation.spaceId,
      entityType: 'invitation',
      entityId: invitation.invitationId,
      action: 'rejected',
      actorUserId: userId,
    });

    await this.notificationsService.create({
      userId: invitation.createdBy,
      spaceId: invitation.spaceId,
      type: 'invitation_rejected',
      title: 'Invitación rechazada',
      message: 'Tu invitación fue rechazada',
      data: { invitationId: invitation.invitationId },
      actorUserId: userId,
    });

    return { message: 'Invitación rechazada' };
  }

  // ─── Revocar ─────────────────────────────────────────────────

  async revoke(invitationId: string, spaceId: string, actorUserId: string) {
    await this.membersService.requireRole(spaceId, actorUserId, ['owner', 'admin']);

    const invitation = await this.invitationModel.findOne({ invitationId, spaceId, estado: 'pending' });
    if (!invitation) throw new NotFoundException('Invitación pendiente no encontrada');

    invitation.estado = 'revoked';
    await invitation.save();

    await this.auditService.log({
      spaceId,
      entityType: 'invitation',
      entityId: invitationId,
      action: 'revoked',
      actorUserId,
    });

    return { message: 'Invitación revocada', invitationId };
  }

  // ─── Generar datos para QR ───────────────────────────────────

  async getQrData(invitationId: string, spaceId: string, actorUserId: string) {
    await this.membersService.requireRole(spaceId, actorUserId, ['owner', 'admin']);

    const invitation = await this.invitationModel.findOne({ invitationId, spaceId });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');

    if (invitation.estado !== 'pending') {
      throw new BadRequestException(`La invitación está ${invitation.estado}, no se puede compartir`);
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('La invitación ha expirado');
    }

    return {
      invitationId: invitation.invitationId,
      shareUrl: invitation.shareUrl,
      deepLink: this.buildDeepLink(invitation.token),
      expiresAt: invitation.expiresAt,
      multiUse: invitation.multiUse,
    };
  }
}
