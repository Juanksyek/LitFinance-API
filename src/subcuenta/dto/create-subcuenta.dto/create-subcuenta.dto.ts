import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSubcuentaDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Type(() => Number)
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

  // Si es true, la subcuenta se crea como "apartado" usando saldo ya existente
  // en la cuenta principal (no suma saldo extra a la cuenta).
  // Si es false/undefined, se mantiene el comportamiento actual.
  @IsOptional()
  @IsBoolean()
  usarSaldoCuentaPrincipal?: boolean;
  
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  divisaConvertida?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tasaCambioUsada?: number;

  @IsOptional()
  @IsString()
  cuentaPrincipalId?: string;

  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  tipoHistorialCuenta?: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente';
  
  @IsOptional()
  @IsString()
  descripcionHistorialCuenta?: string;
}