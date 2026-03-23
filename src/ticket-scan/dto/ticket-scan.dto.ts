import {
  IsString, IsNumber, IsOptional, IsArray, IsBoolean,
  ValidateNested, IsIn, IsDateString, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Item individual del ticket ────────────────────────────────

export class TicketItemDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Min(0)
  cantidad: number;

  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsNumber()
  confianza?: number;
}

// ─── Crear ticket desde texto OCR (frontend envía imagen) ──────

export class CreateTicketFromOcrDto {
  /** Imagen del ticket en base64 (sin prefijo data:...) */
  @IsString()
  imagenBase64: string;

  /** MIME type: image/jpeg, image/png */
  @IsOptional()
  @IsString()
  imagenMimeType?: string;

  /** Moneda (default: monedaPrincipal del usuario) */
  @IsOptional()
  @IsString()
  moneda?: string;

  /** Cuenta a afectar */
  @IsOptional()
  @IsString()
  cuentaId?: string;

  /** Subcuenta a afectar */
  @IsOptional()
  @IsString()
  subCuentaId?: string;

  /** Si debe crear la transacción de egreso automáticamente (default: false, el usuario confirma primero) */
  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;

  /** Texto OCR extraído en el dispositivo (Google ML Kit / Apple Vision) */
  @IsOptional()
  @IsString()
  ocrTexto?: string;
}

// ─── Crear ticket manualmente (fallback sin OCR) ───────────────

export class CreateTicketManualDto {
  @IsString()
  tienda: string;

  @IsOptional()
  @IsString()
  direccionTienda?: string;

  @IsDateString()
  fechaCompra: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TicketItemDto)
  items: TicketItemDto[];

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  impuestos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  descuentos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  propina?: number;

  @IsNumber()
  @Min(0)
  total: number;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsString()
  cuentaId?: string;

  @IsOptional()
  @IsString()
  subCuentaId?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  /** Imagen del ticket en base64 (opcional) */
  @IsOptional()
  @IsString()
  imagenBase64?: string;

  @IsOptional()
  @IsString()
  imagenMimeType?: string;
}

// ─── Confirmar / editar ticket antes de aplicar cargo ──────────

export class ConfirmTicketDto {
  @IsOptional()
  @IsString()
  tienda?: string;

  @IsOptional()
  @IsDateString()
  fechaCompra?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TicketItemDto)
  items?: TicketItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  impuestos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  descuentos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  propina?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsString()
  cuentaId?: string;

  @IsOptional()
  @IsString()
  subCuentaId?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}

// ─── Filtros para listar tickets ───────────────────────────────

export class TicketFiltersDto {
  @IsOptional()
  @IsIn(['processing', 'completed', 'review', 'failed', 'cancelled'])
  estado?: string;

  @IsOptional()
  @IsString()
  tienda?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;
}
