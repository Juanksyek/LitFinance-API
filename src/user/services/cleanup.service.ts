import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema/user.schema';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    ) { }

    async deleteInactiveUsers() {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

        const result = await this.userModel.deleteMany({
            lastActivityAt: { $lt: twelveMonthsAgo },
        });

        this.logger.log(`Usuarios eliminados por inactividad: ${result.deletedCount}`);
        return { deletedUsers: result.deletedCount };
    }
}
