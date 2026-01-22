import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyResetOtpDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @IsString({ message: 'El código debe ser un texto' })
  @Length(4, 8, { message: 'El código debe tener entre 4 y 8 caracteres' })
  otp: string;
}
