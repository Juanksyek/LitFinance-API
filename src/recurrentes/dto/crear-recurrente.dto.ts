import { IsBoolean, IsNumber, IsOptional, IsString, ValidateNested, IsNotEmpty, IsIn, Min, ValidateIf} from 'class-validator';
import { Type } from 'class-transformer';

class PlataformaDto {
  @IsString()
  plataformaId: string;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class CrearRecurrenteDto {
  @IsString()
  nombre: string;

  @ValidateNested()
  @Type(() => PlataformaDto)
  plataforma: PlataformaDto;

  @IsString()
  @IsNotEmpty()
  moneda: string;

  @IsNumber()
  monto: number;

  @IsBoolean()
  afectaCuentaPrincipal: boolean;

  @IsBoolean()
  afectaSubcuenta: boolean;

  @IsOptional()
  @IsString()
  cuentaId?: string;

  @IsOptional()
  @IsString()
  subcuentaId?: string;

  @IsString()
  userId: string;

  @IsOptional()
  recordatorios?: number[];

  @IsIn(['dia_semana', 'dia_mes', 'fecha_anual'])
  frecuenciaTipo: 'dia_semana' | 'dia_mes' | 'fecha_anual';

  @IsString()
  frecuenciaValor: string;

  // ===========================
  // NUEVOS CAMPOS: Planes de Pago
  // ===========================

  @IsIn(['indefinido', 'plazo_fijo'])
  @IsOptional()
  tipoRecurrente?: 'indefinido' | 'plazo_fijo'; // Default: 'indefinido'

  // totalPagos es OBLIGATORIO si tipoRecurrente === 'plazo_fijo'
  @ValidateIf(o => o.tipoRecurrente === 'plazo_fijo')
  @IsNotEmpty({ message: 'totalPagos es obligatorio cuando tipoRecurrente es plazo_fijo' })
  @IsNumber()
  @Min(1, { message: 'totalPagos debe ser mayor a 0' })
  totalPagos?: number;

  @IsOptional()
  fechaInicio?: Date; // Opcional, si no se proporciona se usa la fecha actual
}
