import { IsString, IsNumber, IsDateString, IsOptional, IsIn } from 'class-validator';

export class CreateCuentaHistorialDto {
  @IsString()
  cuentaId: string;

  @IsNumber()
  monto: number;

  @IsString()
  @IsIn(['ingreso', 'egreso', 'ajuste_subcuenta', 'recurrente'])
  tipo: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente';

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
}
