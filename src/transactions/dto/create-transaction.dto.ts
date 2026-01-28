import { IsIn, IsNumber, IsOptional, IsString, IsBoolean, IsDateString } from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['ingreso', 'egreso'])
  tipo: 'ingreso' | 'egreso';

  @IsNumber()
  monto: number;

  @IsOptional()
  @IsString()
  moneda?: string; // Código ISO de la moneda (ej: 'USD', 'MXN')

  @IsString()
  concepto: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  cuentaId?: string;

  @IsOptional()
  @IsString()
  subCuentaId?: string;

  @IsBoolean()
  afectaCuenta: boolean;

  // Fecha efectiva del movimiento (opcional). Si se omite, se usa la fecha actual.
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsString()
  @IsOptional()
  transaccionId?: string;
}