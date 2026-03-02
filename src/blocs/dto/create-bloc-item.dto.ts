import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateBlocItemDto {
  @IsString()
  @MaxLength(40)
  categoria: string;

  @IsString()
  @MaxLength(120)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsString()
  @MaxLength(8)
  moneda: string;

  @IsIn(['monto', 'articulo'])
  modo: 'monto' | 'articulo';

  // modo: monto
  @ValidateIf((o) => o.modo === 'monto')
  @IsNumber()
  monto?: number;

  // modo: articulo
  @ValidateIf((o) => o.modo === 'articulo')
  @IsNumber()
  @Min(0)
  cantidad?: number;

  @ValidateIf((o) => o.modo === 'articulo')
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  @IsOptional()
  @IsDateString()
  vencimiento?: string;

  @IsOptional()
  @IsArray()
  adjuntos?: string[];
}
