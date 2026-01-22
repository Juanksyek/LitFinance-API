import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ForgotPasswordOtpDto } from './dto/forgot-password-otp.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordWithOtpDto } from './dto/reset-password-otp.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  /**
   * Solicitar código OTP para reset de contraseña
   * POST /auth/forgot-password-otp
   */
  @Post('forgot-password-otp')
  @HttpCode(HttpStatus.OK)
  async forgotPasswordOtp(@Body() dto: ForgotPasswordOtpDto) {
    return this.passwordResetService.requestOtp(dto.email);
  }

  /**
   * Verificar código OTP y obtener resetToken
   * POST /auth/verify-reset-otp
   */
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordResetService.verifyOtp(dto.email, dto.otp);
  }

  /**
   * Restablecer contraseña con resetToken
   * POST /auth/reset-password-otp
   */
  @Post('reset-password-otp')
  @HttpCode(HttpStatus.OK)
  async resetPasswordOtp(@Body() dto: ResetPasswordWithOtpDto) {
    return this.passwordResetService.resetPassword(dto.resetToken, dto.newPassword);
  }
}
