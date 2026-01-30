import { IsOptional, IsString, IsDateString, IsArray, IsIn, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AnalyticsFiltersDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsIn(['dia', 'semana', 'mes', '3meses', '6meses', 'año', 'personalizado', 'desdeSiempre'])
  rangoTiempo?: 'dia' | 'semana' | 'mes' | '3meses' | '6meses' | 'año' | 'personalizado' | 'desdeSiempre';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  subcuentas?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  conceptos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  monedas?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  cuentas?: string[];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  incluirRecurrentes?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  soloTransaccionesManuales?: boolean;

  @IsOptional()
  @IsIn(['ingreso', 'egreso', 'ambos'])
  tipoTransaccion?: 'ingreso' | 'egreso' | 'ambos';

  @IsOptional()
  @IsString()
  monedaBase?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  incluirSubcuentasInactivas?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(999999999999)
  montoMinimo?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(999999999999)
  montoMaximo?: number;
}

export class MovimientosFiltersDto extends AnalyticsFiltersDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  pagina?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  limite?: number = 20;

  @IsOptional()
  @IsIn(['fecha', 'monto', 'concepto'])
  ordenarPor?: 'fecha' | 'monto' | 'concepto';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  ordenDireccion?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  busqueda?: string;
}
