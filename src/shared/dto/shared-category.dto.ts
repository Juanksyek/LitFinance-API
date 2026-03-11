import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateSharedCategoryDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  icono?: string;

  @IsString()
  @IsOptional()
  color?: string;
}

export class UpdateSharedCategoryDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  icono?: string;

  @IsString()
  @IsOptional()
  color?: string;
}
