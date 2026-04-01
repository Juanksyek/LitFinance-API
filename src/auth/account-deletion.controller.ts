import { Body, Controller, Post, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { VerifyDeletionOtpDto } from './dto/verify-deletion-otp.dto';
import { ConfirmDeletionDto } from './dto/confirm-deletion.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AccountDeletionController {
  constructor(private readonly accountDeletionService: AccountDeletionService) {}

  /**
   * Step 1: Solicitar código OTP para eliminar la cuenta.
   * Requiere JWT válido — el userId se obtiene del token de sesión.
   *
   * POST /auth/request-account-deletion
   */
  @UseGuards(JwtAuthGuard)
  @Post('request-account-deletion')
  @HttpCode(HttpStatus.OK)
  async requestDeletion(@Req() req: any) {
    return this.accountDeletionService.requestOtp(req.user.id);
  }

  /**
   * Step 2: Verificar el código OTP recibido por correo.
   * Devuelve un deletionToken de corta duración (15 min).
   *
   * POST /auth/verify-deletion-otp
   */
  @UseGuards(JwtAuthGuard)
  @Post('verify-deletion-otp')
  @HttpCode(HttpStatus.OK)
  async verifyDeletionOtp(@Req() req: any, @Body() dto: VerifyDeletionOtpDto) {
    return this.accountDeletionService.verifyOtp(req.user.id, dto.otp);
  }

  /**
   * Step 3: Confirmar la eliminación con el deletionToken.
   * Elimina permanentemente la cuenta y todos los datos.
   *
   * POST /auth/confirm-account-deletion
   */
  @UseGuards(JwtAuthGuard)
  @Post('confirm-account-deletion')
  @HttpCode(HttpStatus.OK)
  async confirmDeletion(@Body() dto: ConfirmDeletionDto) {
    return this.accountDeletionService.confirmDeletion(dto.deletionToken);
  }
}
