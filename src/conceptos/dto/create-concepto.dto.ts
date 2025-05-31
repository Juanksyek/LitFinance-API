import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConceptoDto {
  @IsNotEmpty()
  @IsString()
  nombre: string;

  @IsNotEmpty()
  @IsString()
  color: string;

  @IsOptional()
  @IsString()
  icono?: string;
}
