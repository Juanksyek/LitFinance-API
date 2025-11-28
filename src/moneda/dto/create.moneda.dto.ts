import { IsString, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';

export class CreateMonedaDto {
  @IsString() codigo: string;
  @IsString() nombre: string;
  @IsString() simbolo: string;
  @IsOptional() @IsBoolean() isPrincipal?: boolean;

  // Tasa de conversión respecto a MXN (por defecto 1 si no se especifica)
  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaBase?: number;
}