import { Controller, Get, Patch, Body, Req, UseGuards, Delete, Param, Post } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { CleanupService } from './services/cleanup.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
    async updateProfile(@Req() req, @Body() updateData: UpdateProfileDto) {
        const userId = req.user.sub;
        return this.userService.updateProfile(userId, updateData);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @Get('cleanup')
    async cleanupInactiveUsers() {
      return this.cleanupService.deleteInactiveUsers();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @Delete('delete-completely/:userId')
    async deleteUserCompletely(@Param('userId') userId: string) {
        return this.cleanupService.deleteUserCompletely(userId);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @Post('format-account/:userId')
    async formatUserAccount(@Param('userId') userId: string) {
        return this.cleanupService.formatUserAccount(userId);
    }
}
