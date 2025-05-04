import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateCuentaDto {
  @IsNotEmpty()
  @IsString()
  nombre: string;

  @IsNotEmpty()
  @IsString()
  moneda: string;

  @IsOptional()
  @IsNumber()
  cantidad?: number;

  @IsOptional()
  @IsString()
  simbolo?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNotEmpty()
  @IsString()
  usuarioId: string;
}
