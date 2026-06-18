import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AccountResetService } from './account-reset.service';
import { ResetAccountDto } from './dto/reset-account.dto';

@Controller('auth')
export class AccountResetController {
  constructor(private readonly accountResetService: AccountResetService) {}

  @UseGuards(JwtAuthGuard)
  @Post('reset-account')
  @HttpCode(HttpStatus.OK)
  async resetAccount(@Req() req: any, @Body() dto: ResetAccountDto) {
    return this.accountResetService.resetAccountFromZero(req.user.id, dto.currentPassword);
  }
}
