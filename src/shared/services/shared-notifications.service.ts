import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedNotification, SharedNotificationDocument } from '../schemas/shared-notification.schema';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedNotificationsService {
  private readonly logger = new Logger(SharedNotificationsService.name);

  constructor(
    @InjectModel(SharedNotification.name)
    private readonly notifModel: Model<SharedNotificationDocument>,
    private readonly pushService: NotificacionesService,
  ) {}

  async create(params: {
    userId: string;
    spaceId?: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    actorUserId?: string;
    sendPush?: boolean;
  }): Promise<void> {
    const notificationId = await generateUniqueId(this.notifModel, 'notificationId');

    await this.notifModel.create({
      notificationId,
      userId: params.userId,
      spaceId: params.spaceId,
      type: params.type,
      title: params.title,
      message: params.message,
      data: params.data ?? {},
      actorUserId: params.actorUserId,
      read: false,
    });

    if (params.sendPush !== false) {
      try {
        await this.pushService.enviarNotificacionPush(
          params.userId,
          params.title,
          params.message,
          { type: params.type, spaceId: params.spaceId, ...params.data },
        );
      } catch (err) {
        this.logger.warn(`Push fallido para ${params.userId}: ${err.message}`);
      }
    }
  }

  async notifyMany(
    userIds: string[],
    params: Omit<Parameters<SharedNotificationsService['create']>[0], 'userId'>,
  ): Promise<void> {
    await Promise.all(userIds.map((uid) => this.create({ ...params, userId: uid })));
  }

  async listByUser(userId: string, page = 1, limit = 30) {
    const skip = (page - 1) * limit;
    const [items, total, unreadCount] = await Promise.all([
      this.notifModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.notifModel.countDocuments({ userId }),
      this.notifModel.countDocuments({ userId, read: false }),
    ]);
    return { items, total, unreadCount, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notifModel.countDocuments({ userId, read: false });
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.notifModel.updateOne(
      { notificationId, userId },
      { $set: { read: true, readAt: new Date() } },
    );
  }

  async markAllRead(userId: string): Promise<{ modified: number }> {
    const result = await this.notifModel.updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: new Date() } },
    );
    return { modified: result.modifiedCount };
  }
}
