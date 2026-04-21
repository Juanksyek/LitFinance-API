import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
  IsBoolean,
  Min,
  Max,
  Length,
  ArrayMaxSize,
  IsHexColor,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─────────────────────────────────────────────────────────────────────────────
// Reminder DTO
// ─────────────────────────────────────────────────────────────────────────────

export class CreateReminderDto {
  @IsEnum(['corte', 'pago', 'custom'])
  tipo: 'corte' | 'pago' | 'custom';

  /** Días antes del evento (opcional si se usa `fecha`) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  diasAntes?: number;

  /** Fecha específica para recordatorio (ISO). Si se proporciona, puede combinarse con `diasAntes` para recordar X días antes de esta fecha. */
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Credit Card
// ─────────────────────────────────────────────────────────────────────────────

export class CreateCreditCardDto {
  @IsString()
  @Length(1, 60)
  nombre: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  last4?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  emisor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  banco?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  /** Moneda ISO-4217 (default: MXN) */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  moneda?: string;

  @IsNumber()
  @Min(1)
  limiteCredito: number;

  /** Saldo ya usado actualmente en la tarjeta (opcional, para importaciones) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  saldoUsado?: number;

  /** Día del mes del corte (1–31) */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(31)
  diaCorte?: number;

  /** Día del mes del vencimiento de pago (1–31) */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(31)
  diaPago?: number;

  /** Porcentaje de pago mínimo (default: 5) */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  porcentajePagoMinimo?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateReminderDto)
  recordatorios?: CreateReminderDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Credit Card
// ─────────────────────────────────────────────────────────────────────────────

export class UpdateCreditCardDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  nombre?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  last4?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  emisor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  banco?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limiteCredito?: number;

  /** Ajustar el saldo usado manualmente (opcional). Validar en el servicio. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  saldoUsado?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(31)
  diaCorte?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(31)
  diaPago?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  porcentajePagoMinimo?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateReminderDto)
  recordatorios?: CreateReminderDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Movement (compra / cargo)
// ─────────────────────────────────────────────────────────────────────────────

export class AddMovimientoDto {
  @IsEnum(['compra', 'pago', 'credito', 'ajuste'])
  tipo: 'compra' | 'pago' | 'credito' | 'ajuste';

  @IsNumber()
  @Min(0.01)
  monto: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  moneda?: string;

  @IsString()
  @Length(1, 120)
  descripcion: string;

  @IsOptional()
  @IsString()
  concepto?: string;

  /** ISO date string. Defaults to now if omitted. */
  @IsOptional()
  @IsDateString()
  fecha?: string;
  
  @IsOptional()
  @IsString()
  cuentaId?: string;
  
  @IsOptional()
  @IsString()
  subCuentaId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination query
// ─────────────────────────────────────────────────────────────────────────────

export class MovimientosQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
