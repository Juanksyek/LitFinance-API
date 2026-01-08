import { Controller, Get, Patch, Body, Req, UseGuards, Delete, Param, Post, Optional } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { CleanupService } from './services/cleanup.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ToggleFavoritaMonedaDto } from '../moneda/dto/toggle-favorita-moneda.dto';
import { SubscriptionVerifyCronService } from './subscription-verify-cron.service';

@Controller('user')
export class UserController {
    constructor(
        private readonly userService: UserService,
              private readonly cleanupService: CleanupService,
              @Optional() private readonly subscriptionVerifyCronService?: SubscriptionVerifyCronService,
    ) { }

    @UseGuards(JwtAuthGuard)
    @Get('profile')
    async getProfile(@Req() req: any) {
        return this.userService.getProfile(req.user.id);
    }

    @Patch('update')
    @UseGuards(JwtAuthGuard)
    async updateProfile(@Req() req, @Body() updateData: UpdateProfileDto) {
        const userId = req.user.id;
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

    @UseGuards(JwtAuthGuard)
    @Post('monedas/toggle-favorita')
    async toggleMonedaFavorita(@Req() req: any, @Body() dto: ToggleFavoritaMonedaDto) {
        const userId = req.user.id;
        return this.userService.toggleMonedaFavorita(userId, dto.codigoMoneda);
    }

    @UseGuards(JwtAuthGuard)
    @Get('monedas/favoritas')
    async getMonedasFavoritas(@Req() req: any) {
        const userId = req.user.id;
        return this.userService.getMonedasFavoritas(userId);
    }

        @UseGuards(JwtAuthGuard, RolesGuard)
        @Roles('admin')
        @Post('admin/verify-subscriptions')
        async adminVerifySubscriptions() {
            // Trigger the subscription verification cron job on demand
            if (this.subscriptionVerifyCronService && typeof this.subscriptionVerifyCronService.verifySubscriptions === 'function') {
                await this.subscriptionVerifyCronService.verifySubscriptions();
                return { message: 'Verification triggered' };
            }
            return { message: 'Service not available' };
        }

        @UseGuards(JwtAuthGuard, RolesGuard)
        @Roles('admin')
        @Post('admin/verify-subscription')
        async adminVerifySubscription(@Body() body: { subscriptionId?: string; userMongoId?: string }) {
            if (this.subscriptionVerifyCronService && typeof this.subscriptionVerifyCronService.verifyOne === 'function') {
                const result = await this.subscriptionVerifyCronService.verifyOne({
                    subscriptionId: body?.subscriptionId,
                    userMongoId: body?.userMongoId,
                });
                return { message: 'Verification completed', result };
            }
            return { message: 'Service not available' };
        }
}
