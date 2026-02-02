import { Controller, Get, Patch, Body, Req, UseGuards, Delete, Param, Post, Optional } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { CleanupService } from './services/cleanup.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ToggleFavoritaMonedaDto } from '../moneda/dto/toggle-favorita-moneda.dto';
import { SubscriptionVerifyCronService } from './subscription-verify-cron.service';
import { PremiumCronService } from './premium-cron.service';
import { PlanAutoPauseService } from './services/plan-auto-pause.service';

@Controller('user')
export class UserController {
    constructor(
        private readonly userService: UserService,
              private readonly cleanupService: CleanupService,
              private readonly planAutoPauseService: PlanAutoPauseService,
              @Optional() private readonly subscriptionVerifyCronService?: SubscriptionVerifyCronService,
              @Optional() private readonly premiumCronService?: PremiumCronService,
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

        /**
         * 🔥 Endpoint para forzar reconciliación de recursos (pausar/reanudar según estado premium)
         * 
         * POST /user/admin/reconcile-premium-resources
         * Body (opcional): { userId?: string }
         * 
         * - Sin userId: Reconcilia TODOS los usuarios (puede tardar con muchos usuarios)
         * - Con userId: Reconcilia solo ese usuario específico
         * 
         * Retorna estadísticas de usuarios procesados y recursos pausados/reanudados
         */
        @UseGuards(JwtAuthGuard, RolesGuard)
        @Roles('admin')
        @Post('admin/reconcile-premium-resources')
        async adminReconcilePremiumResources(@Body() body?: { userId?: string }) {
            if (!this.premiumCronService) {
                return { message: 'PremiumCronService not available', success: false };
            }

            try {
                if (body?.userId) {
                    // Reconciliar un usuario específico
                    const result = await this.premiumCronService.reconcileSingleUser(body.userId);
                    return {
                        success: true,
                        message: `Usuario ${body.userId} reconciliado`,
                        ...result,
                    };
                } else {
                    // Reconciliar todos los usuarios
                    await this.premiumCronService.reconcilePremiumStates();
                    return {
                        success: true,
                        message: 'Reconciliación de todos los usuarios completada (ver logs para detalles)',
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    message: 'Error durante reconciliación',
                    error: error.message,
                };
            }
        }

        /**
         * 🎯 Forzar en DB la pausa/reanudación por límites del plan (sin esperar a cron).
         *
         * POST /user/admin/enforce-plan-limits
         * Body: { userId: string, targetPlanType?: 'free_plan' | 'premium_plan' }
         */
        @UseGuards(JwtAuthGuard, RolesGuard)
        @Roles('admin')
        @Post('admin/enforce-plan-limits')
        async adminEnforcePlanLimits(
            @Body() body: { userId?: string; targetPlanType?: 'free_plan' | 'premium_plan' },
        ) {
            const userId = String(body?.userId ?? '').trim();
            if (!userId) {
                return { success: false, message: 'userId es requerido' };
            }

            let targetPlanType = body?.targetPlanType;
            if (targetPlanType !== 'free_plan' && targetPlanType !== 'premium_plan') {
                // Inferir del perfil
                const profile: any = await this.userService.getProfile(userId);
                targetPlanType = (profile?.planType === 'premium_plan' ? 'premium_plan' : 'free_plan');
            }

            const result = await this.planAutoPauseService.enforcePlanLimits(
                userId,
                targetPlanType,
                'admin.enforce',
            );

            return {
                success: true,
                userId,
                targetPlanType,
                result,
            };
        }
}
