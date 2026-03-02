import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBlocDto {
  @IsString()
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icono?: string;

  @IsIn(['cuentas', 'compras'])
  tipo: 'cuentas' | 'compras';
}
