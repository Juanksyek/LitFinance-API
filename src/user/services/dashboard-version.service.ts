import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema/user.schema';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class DashboardVersionService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly redis: RedisService,
  ) {}

  async touchDashboard(userId: string, _reason?: string): Promise<void> {
    // $inc crea el campo si no existe, ideal para usuarios legacy
    await this.userModel.updateOne(
      { id: userId },
      {
        $inc: { dashboardVersion: 1 },
        $set: { dashboardUpdatedAt: new Date() },
      },
    );

    // Invalidate Redis caches so the next request always gets fresh data.
    // Fire-and-forget: don't block the calling operation.
    void this.redis.invalidateUserDashboard(userId);
  }
}
