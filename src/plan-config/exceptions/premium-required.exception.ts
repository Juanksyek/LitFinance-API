import { ForbiddenException } from '@nestjs/common';

export class PremiumRequiredException extends ForbiddenException {
  constructor(message = 'Requiere premium para realizar esta acción') {
    super({
      statusCode: 403,
      code: 'PREMIUM_REQUIRED',
      message,
    });
  }
}
