import { IsBoolean, IsNumber, IsOptional, IsString, ValidateNested, IsNotEmpty, ValidateIf, IsIn } from 'class-validator';
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
  
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  subcuentaId?: string;

  @IsOptional()
  recordatorios?: number[];

  // Nuevos campos para frecuencia personalizada:
  @ValidateIf((o) => !o.diaMes && !o.fechaAnual)
  @IsOptional()
  @IsIn([0, 1, 2, 3, 4, 5, 6])
  diaSemana?: number; // 0 = domingo, 6 = sábado

  @ValidateIf((o) => !o.diaSemana && !o.fechaAnual)
  @IsOptional()
  @IsIn([...Array(31).keys()].map(i => i + 1)) // 1 a 31
  diaMes?: number;

  @ValidateIf((o) => !o.diaSemana && !o.diaMes)
  @IsOptional()
  @IsString() // formato MM-DD (ej. "11-20" para 20 de noviembre)
  fechaAnual?: string;
}