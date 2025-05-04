import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateCuentaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsNumber()
  cantidad?: number;

  @IsOptional()
  @IsString()
  simbolo?: string;

  @IsOptional()
  @IsString()
  color?: string;
}