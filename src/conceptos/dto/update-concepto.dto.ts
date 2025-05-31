import { IsOptional, IsString } from 'class-validator';

export class UpdateConceptoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icono?: string;
}
