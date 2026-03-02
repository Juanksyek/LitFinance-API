import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class UpsertBlocItemDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  titulo?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsString()
  modo?: 'monto' | 'articulo';

  @IsOptional()
  monto?: number;

  @IsOptional()
  cantidad?: number;

  @IsOptional()
  precioUnitario?: number;

  @IsOptional()
  vencimiento?: string;

  @IsOptional()
  @IsArray()
  adjuntos?: string[];
}

export class PatchBlocItemsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertBlocItemDto)
  upserts?: UpsertBlocItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteItemIds?: string[];
}
