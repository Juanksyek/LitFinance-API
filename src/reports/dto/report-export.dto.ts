import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type ReportExportFormat = 'pdf' | 'xlsx';

export class ExportReportQueryDto {
  @IsIn(['pdf', 'xlsx'])
  format: ReportExportFormat = 'pdf';

  /** Compat con analytics: rango = dia|semana|mes|3meses|6meses|año */
  @IsOptional()
  @IsString()
  rango?: string;

  /** Si vienen fechas explícitas, se priorizan sobre rango */
  @IsOptional()
  @IsISO8601()
  fechaInicio?: string;

  @IsOptional()
  @IsISO8601()
  fechaFin?: string;

  /** Moneda base para totales/analíticas */
  @IsOptional()
  @IsString()
  monedaBase?: string;

  /** Máximo de movimientos a incluir (útil para PDF/Excel) */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(20000)
  limiteMovimientos?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(50)
  topN?: number;

  /** Si = 0, omite la tabla de movimientos (solo resumen/insights) */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const v = String(value).toLowerCase().trim();
    return v === '1' || v === 'true' || v === 'yes';
  })
  incluirMovimientos?: boolean;
}
