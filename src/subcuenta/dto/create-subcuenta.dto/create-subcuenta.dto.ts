import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateSubcuentaDto {
  @IsString()
  nombre: string;

  @IsNumber()
  cantidad: number;

  @IsString()
  moneda: string;

  @IsOptional()
  @IsString()
  simbolo?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  cuentaId?: string;

  @IsBoolean()
  afectaCuenta: boolean;
  
  @IsOptional()
  @IsNumber()
  divisaConvertida?: number;

  @IsOptional()
  @IsNumber()
  tasaCambioUsada?: number;

  @IsOptional()
  @IsString()
  cuentaPrincipalId?: string;

  @IsOptional()
  @IsString()
  subCuentaId?: string;

  @IsString()
  userId: string
}