import { IsBoolean, IsNumber, IsOptional, IsString, ValidateNested, IsNotEmpty, IsIn} from 'class-validator';
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
}
