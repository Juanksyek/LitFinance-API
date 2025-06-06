import { IsString, IsNumber, IsDateString, IsOptional, IsIn } from 'class-validator';

export class CreateCuentaHistorialDto {
  @IsString()
  cuentaId: string;

  @IsString()
  userId: string;

  @IsNumber()
  monto: number;

  @IsString()
  @IsIn(['ingreso', 'egreso', 'ajuste_subcuenta', 'recurrente', 'cambio_moneda'])
  tipo: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente' | 'cambio_moneda';

  @IsString()
  descripcion: string;

  @IsDateString()
  fecha: string;

  @IsOptional()
  @IsString()
  subcuentaId?: string;

  @IsOptional()
  @IsString()
  conceptoId?: string;

  @IsOptional()
  metadata?: any;
}
