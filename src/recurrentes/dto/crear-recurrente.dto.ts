import { IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PlataformaDto {
  @IsString()
  plataformaId: string;

  @IsString()
  nombre: string;

  @IsString()
  @IsOptional()
  categoria?: string;

  @IsString()
  @IsOptional()
  color?: string;
}

export class CrearRecurrenteDto {
  @IsString()
  nombre: string;

  @ValidateNested()
  @Type(() => PlataformaDto)
  plataforma: PlataformaDto;

  @IsNumber()
  frecuenciaDias: number;

  @IsNumber()
  monto: number;

  @IsBoolean()
  afectaCuentaPrincipal: boolean;

  @IsBoolean()
  afectaSubcuenta: boolean;

  @IsString()
  cuentaId: string;

  @IsString()
  @IsOptional()
  subcuentaId?: string;

  @IsString()
  userId: string;

  @IsOptional()
  recordatorios?: number[];
}