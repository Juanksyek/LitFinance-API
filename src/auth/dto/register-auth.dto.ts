import { IsEmail, IsNotEmpty, MinLength, MaxLength, IsInt, Min, Max, IsString } from 'class-validator';

export class RegisterAuthDto {
  @IsNotEmpty()
  nombreCompleto: string;

  @IsInt()
  @Min(13)
  @Max(100)
  edad: number;

  @IsString()
  @IsNotEmpty({ message: 'La ocupación no puede estar vacía' })
  ocupacion: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  @MaxLength(32)
  password: string;

  @MinLength(6)
  @MaxLength(32)
  confirmPassword: string;
}
