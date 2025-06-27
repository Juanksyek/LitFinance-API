import { IsString, IsOptional } from 'class-validator';

export class CrearPlataformaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  color?: string;
}