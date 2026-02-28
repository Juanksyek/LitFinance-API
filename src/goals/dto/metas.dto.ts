import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
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

  // Ingreso: se interpreta como moneda del ORIGEN.
  // Egreso: se interpreta como moneda de la META (origen de fondos).
  @IsOptional()
  @IsString()
  moneda?: string;

  // Nuevo (preferido): endpoint origen/destino
  @IsOptional()
  @IsIn(['cuenta', 'subcuenta'])
  origenTipo?: 'cuenta' | 'subcuenta';

  // Para origenTipo='cuenta': opcional (si no viene, se usa cuenta principal)
  // Para origenTipo='subcuenta': requerido
  @IsOptional()
  @IsString()
  origenId?: string;

  @IsOptional()
  @IsIn(['cuenta', 'subcuenta'])
  destinoTipo?: 'cuenta' | 'subcuenta';

  // Para destinoTipo='cuenta': opcional (si no viene, se usa cuenta principal)
  // Para destinoTipo='subcuenta': requerido
  @IsOptional()
  @IsString()
  destinoId?: string;

  // Legacy compat (se seguirá aceptando):
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

  @IsOptional()
  @IsString()
  concepto?: string;

  @IsOptional()
  @IsString()
  conceptoId?: string;
}

export class ResolveMetaCompletionDto {
  @IsIn(['keep', 'transfer_to_main', 'mark_used'])
  moneyAction: 'keep' | 'transfer_to_main' | 'mark_used';

  @IsIn(['none', 'archive', 'reset', 'duplicate'])
  metaAction: 'none' | 'archive' | 'reset' | 'duplicate';

  // Requerido si moneyAction = mark_used
  @IsOptional()
  @IsString()
  motivo?: string;

  // Si moneyAction = mark_used, puede elegir también mover fondos a principal
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  moveToMain?: boolean;

  // Opcional: permitir monto parcial. Si no viene, se asume "todo".
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  amount?: number;

  // Solo si metaAction = reset
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  resetObjetivo?: number;

  @IsOptional()
  @IsString()
  resetFechaObjetivo?: string;
}
