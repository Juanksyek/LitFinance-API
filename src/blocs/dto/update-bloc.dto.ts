import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBlocDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icono?: string;

  @IsOptional()
  @IsIn(['cuentas', 'compras'])
  tipo?: 'cuentas' | 'compras';
}
