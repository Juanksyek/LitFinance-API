import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateMetaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  objetivo: number;

  @IsString()
  @IsNotEmpty()
  moneda: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icono?: string;

  @IsOptional()
  @IsString()
  fechaObjetivo?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(10)
  prioridad?: number;

  // Vinculación con subcuenta
  @IsOptional()
  @IsBoolean()
  crearSubcuenta?: boolean;

  @IsOptional()
  @IsString()
  subcuentaId?: string;
}

export class UpdateMetaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  objetivo?: number;

  @IsOptional()
  @IsString()
  fechaObjetivo?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(10)
  prioridad?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icono?: string;
}

export class ListMetasQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['activa', 'pausada', 'archivada', 'completada'])
  estado?: string;
}

export class MetaMoneyDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  monto: number;

  // Por simplicidad y consistencia, se interpreta como moneda del ORIGEN.
  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsString()
  origenCuentaId?: string;

  @IsOptional()
  @IsString()
  destinoCuentaId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  nota?: string;
}
