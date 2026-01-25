import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema/user.schema';

@Injectable()
export class DashboardVersionService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async touchDashboard(userId: string, _reason?: string): Promise<void> {
    // $inc crea el campo si no existe, ideal para usuarios legacy
    await this.userModel.updateOne(
      { id: userId },
      {
        $inc: { dashboardVersion: 1 },
        $set: { dashboardUpdatedAt: new Date() },
      },
    );
  }
}
