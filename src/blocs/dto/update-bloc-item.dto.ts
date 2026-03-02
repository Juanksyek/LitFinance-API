import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateBlocItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titulo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  moneda?: string;

  @IsOptional()
  @IsIn(['monto', 'articulo'])
  modo?: 'monto' | 'articulo';

  @ValidateIf((o) => o.modo === 'monto')
  @IsOptional()
  @IsNumber()
  monto?: number;

  @ValidateIf((o) => o.modo === 'articulo')
  @IsOptional()
  @IsNumber()
  @Min(0)
  cantidad?: number;

  @ValidateIf((o) => o.modo === 'articulo')
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  @IsOptional()
  @IsIn(['pendiente', 'parcial', 'pagado', 'archivado'])
  estado?: 'pendiente' | 'parcial' | 'pagado' | 'archivado';

  @IsOptional()
  @IsNumber()
  pagadoAcumulado?: number;

  @IsOptional()
  @IsDateString()
  vencimiento?: string;

  @IsOptional()
  @IsArray()
  adjuntos?: string[];
}
