import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PlanConfigService } from '../plan-config.service';
import { PLAN_ACTION_KEY, PlanActionType } from '../decorators/plan-action.decorator';

@Injectable()
export class PlanActionGuard implements CanActivate {
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
      throw new ForbiddenException(validation.message || 'Acción no permitida en tu plan');
    }

    return true;
  }
}
