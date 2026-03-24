import {
  Controller, Get, Patch, Param, Query, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedNotificationsService } from '../services/shared-notifications.service';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/notifications')
export class SharedNotificationsController {
  constructor(private readonly notificationsService: SharedNotificationsService) {}

  /** GET /shared/notifications — Listar notificaciones del usuario */
  @Get()
  list(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('spaceId') spaceId?: string,
  ) {
    return this.notificationsService.listByUser(
      req.user.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 30,
    );
  }

  /** GET /shared/notifications/unread-count — Contador de no leídas */
  @Get('unread-count')
  unreadCount(@Req() req) {
    return this.notificationsService.unreadCount(req.user.id);
  }

  /** PATCH /shared/notifications/:notificationId/read — Marcar como leída */
  @Patch(':notificationId/read')
  markRead(@Req() req, @Param('notificationId') notificationId: string) {
    return this.notificationsService.markRead(notificationId, req.user.id);
  }

  /** PATCH /shared/notifications/read-all — Marcar todas como leídas */
  @Patch('read-all')
  markAllRead(@Req() req) {
    return this.notificationsService.markAllRead(req.user.id);
  }
}
