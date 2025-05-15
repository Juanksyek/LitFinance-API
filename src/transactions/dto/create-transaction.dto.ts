import { IsIn, IsNumber, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['ingreso', 'egreso'])
  tipo: 'ingreso' | 'egreso';

  @IsNumber()
  monto: number;

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

  @IsString()
  @IsOptional()
  transaccionId?: string;
}