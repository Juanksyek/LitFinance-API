import { IsEmail } from 'class-validator';

export class ForgotPasswordOtpDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;
}
