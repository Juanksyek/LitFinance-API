import {
  Controller, Get, Post, Patch, Param, Body, Query, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedInvitationsService } from '../services/shared-invitations.service';
import { SharedMembersService } from '../services/shared-members.service';
import { CreateInvitationDto } from '../dto/shared-invitation.dto';
import { UpdateMemberRoleDto } from '../dto/shared-member.dto';

@Controller('shared')
export class SharedInvitationsController {
  constructor(
    private readonly invitationsService: SharedInvitationsService,
    private readonly membersService: SharedMembersService,
  ) {}

  // ─── Invitaciones ────────────────────────────────────────────

  /** POST /shared/spaces/:spaceId/invitations — Crear invitación (direct/email/link) */
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Post('spaces/:spaceId/invitations')
  createInvitation(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(spaceId, req.user.id, dto);
  }

  /** GET /shared/spaces/:spaceId/invitations — Listar invitaciones del espacio */
  @UseGuards(JwtAuthGuard)
  @Get('spaces/:spaceId/invitations')
  listBySpace(@Req() req, @Param('spaceId') spaceId: string) {
    return this.invitationsService.listBySpace(spaceId);
  }

  /** GET /shared/invitations/pending — Invitaciones pendientes del usuario actual */
  @UseGuards(JwtAuthGuard)
  @Get('invitations/pending')
  listPending(@Req() req) {
    return this.invitationsService.listPendingForUser(req.user.id);
  }

  /**
   * GET /shared/invitations/verify?token=xxx
   * Verificar token de invitación (público para mostrar landing).
   * Requiere autenticación para saber si el usuario ya es miembro.
   */
  @UseGuards(JwtAuthGuard)
  @Get('invitations/verify')
  verifyToken(@Query('token') token: string) {
    return this.invitationsService.verifyToken(token);
  }

  /**
   * POST /shared/invitations/accept-by-token
   * Aceptar invitación usando el token (URL/QR/email link).
   */
  @UseGuards(JwtAuthGuard)
  @Post('invitations/accept-by-token')
  acceptByToken(@Req() req, @Body('token') token: string) {
    return this.invitationsService.acceptByToken(token, req.user.id);
  }

  /** POST /shared/invitations/:invitationId/accept — Aceptar (legacy, in-app) */
  @UseGuards(JwtAuthGuard)
  @Post('invitations/:invitationId/accept')
  accept(@Req() req, @Param('invitationId') invitationId: string) {
    return this.invitationsService.accept(invitationId, req.user.id);
  }

  /** POST /shared/invitations/:invitationId/reject — Rechazar */
  @UseGuards(JwtAuthGuard)
  @Post('invitations/:invitationId/reject')
  reject(@Req() req, @Param('invitationId') invitationId: string) {
    return this.invitationsService.reject(invitationId, req.user.id);
  }

  /** POST /shared/spaces/:spaceId/invitations/:invitationId/revoke — Revocar */
  @UseGuards(JwtAuthGuard)
  @Post('spaces/:spaceId/invitations/:invitationId/revoke')
  revoke(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.revoke(invitationId, spaceId, req.user.id);
  }

  /** GET /shared/spaces/:spaceId/invitations/:invitationId/qr — Obtener datos para generar QR */
  @UseGuards(JwtAuthGuard)
  @Get('spaces/:spaceId/invitations/:invitationId/qr')
  getQrData(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.getQrData(invitationId, spaceId, req.user.id);
  }

  // ─── Miembros ────────────────────────────────────────────────

  /** GET /shared/spaces/:spaceId/members — Listar miembros */
  @UseGuards(JwtAuthGuard)
  @Get('spaces/:spaceId/members')
  listMembers(@Req() req, @Param('spaceId') spaceId: string) {
    return this.membersService.listMembers(spaceId);
  }

  /** PATCH /shared/spaces/:spaceId/members/:memberId/role — Cambiar rol */
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Patch('spaces/:spaceId/members/:memberId/role')
  changeRole(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.membersService.changeRole({
      spaceId,
      memberId,
      newRole: dto.rol,
      actorUserId: req.user.id,
    });
  }

  /** Post /shared/spaces/:spaceId/members/:memberId/remove — Remover miembro */
  @UseGuards(JwtAuthGuard)
  @Post('spaces/:spaceId/members/:memberId/remove')
  removeMember(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.removeMember({
      spaceId,
      memberId,
      actorUserId: req.user.id,
    });
  }

  /** POST /shared/spaces/:spaceId/leave — Abandonar espacio */
  @UseGuards(JwtAuthGuard)
  @Post('spaces/:spaceId/leave')
  leave(@Req() req, @Param('spaceId') spaceId: string) {
    return this.membersService.leaveSpace({
      spaceId,
      userId: req.user.id,
    });
  }
}
