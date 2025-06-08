import { IsEmail, IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(4, 4, { message: 'El código debe tener 4 dígitos' })
  code: string;

  @IsString()
  newPassword: string;

  @IsString()
  confirmPassword: string;
}
