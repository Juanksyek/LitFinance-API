import { IsString, MinLength } from 'class-validator';

export class ResetPasswordWithOtpDto {
  @IsString({ message: 'El token debe ser un texto' })
  resetToken: string;

  @IsString({ message: 'La contraseña debe ser un texto' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  newPassword: string;
}
