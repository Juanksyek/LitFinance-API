import { IsString, IsOptional, IsEmail, IsInt, Min, Max, IsBoolean } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  nombreCompleto?: string;

  @IsOptional()
  @IsInt()
  @Min(13)
  @Max(100)
  edad?: number;

  @IsOptional()
  @IsString()
  ocupacion?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  pais?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  monedaPreferencia?: string;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;
}
