import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { CleanupService } from './services/cleanup.service';

@Controller('user')
export class UserController {
    constructor(
        private readonly userService: UserService,
        private readonly cleanupService: CleanupService
    ) { }

    @UseGuards(JwtAuthGuard)
    @Get('profile')
    async getProfile(@Req() req: any) {
        return this.userService.getProfile(req.user.sub);
    }

    @Patch('update')
    @UseGuards(JwtAuthGuard)
    async updateProfile(@Req() req, @Body() updateData: any) {
        const userId = req.user.sub;
        return this.userService.updateProfile(userId, updateData);
    }

    @UseGuards(JwtAuthGuard)
    @Get('cleanup')
    async cleanupInactiveUsers() {
        return this.cleanupService.deleteInactiveUsers();
    }
}
