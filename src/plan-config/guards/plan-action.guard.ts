import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PlanConfigService } from '../plan-config.service';
import { PLAN_ACTION_KEY, PlanActionType } from '../decorators/plan-action.decorator';
import { PremiumRequiredException } from '../exceptions/premium-required.exception';

@Injectable()
export class PlanActionGuard implements CanActivate {
  private readonly logger = new Logger(PlanActionGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly planConfigService: PlanConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actionType = this.reflector.getAllAndOverride<PlanActionType>(PLAN_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no plan action is required, allow.
    if (!actionType) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user: any = (request as any)?.user;

    // Debug logging useful in production to trace why a 403 PREMIUM_REQUIRED
    // may be returned before other handlers log anything. Enable by setting
    // environment variable DEBUG_PLAN_GUARD=1
    if (process.env.DEBUG_PLAN_GUARD === '1') {
      try {
        const auth = request.headers?.authorization ?? null;
        this.logger.log(`Request ${request.method} ${request.url} - auth:${auth ? 'present' : 'missing'}`);
        this.logger.log(`ActionType=${String(actionType)}, userId=${user?.id ?? user?.sub ?? 'no-user'}, planType=${user?.planType ?? user?.isPremium}`);
      } catch (e) {
        this.logger.error('Error logging PlanActionGuard debug info', (e as any)?.stack ?? e);
      }
    }

    const userId = user?.id ?? user?.sub;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const planType: string = user?.planType ?? (user?.isPremium ? 'premium_plan' : 'free_plan');

    const validation = await this.planConfigService.canPerformAction(
      String(userId),
      planType,
      actionType,
    );

    if (!validation.allowed) {
      throw new PremiumRequiredException(validation.message || 'Acción no permitida en tu plan');
    }

    return true;
  }
}
