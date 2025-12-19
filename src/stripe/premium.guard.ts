import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isPremium } from './is-premium';

@Injectable()
export class PremiumGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (!isPremium(req.user)) throw new ForbiddenException('Premium required');
    return true;
  }
}
