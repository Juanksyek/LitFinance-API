import { IsEmail, IsNotEmpty, MinLength, MaxLength, IsInt, Min, Max, IsString, IsOptional, IsBoolean } from 'class-validator';

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

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  @IsOptional()  // Cambiado a opcional
  @IsString()
  monedaPreferencia?: string;
}
