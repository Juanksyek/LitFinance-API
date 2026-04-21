import { IsString, IsInt, IsBoolean, Min, IsOptional } from 'class-validator';

export class CreatePlanConfigDto {
  @IsString()
  planType: string;

  @IsInt()
  @Min(1)
  transaccionesPorDia: number;

  @IsInt()
  @Min(1)
  historicoLimitadoDias: number;

  @IsInt()
  @Min(0)
  recurrentesPorUsuario: number;

  @IsInt()
  @Min(0)
  subcuentasPorUsuario: number;

  @IsInt()
  @Min(-1)
  tarjetasPorUsuario: number;

  @IsBoolean()
  graficasAvanzadas: boolean;

  @IsOptional()
  @IsBoolean()
  reportesExportables?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
  
    @IsBoolean()
    @IsOptional()
    allowOverdraft?: boolean;
}

export class UpdatePlanConfigDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  transaccionesPorDia?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  historicoLimitadoDias?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurrentesPorUsuario?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  subcuentasPorUsuario?: number;

  @IsOptional()
  @IsInt()
  @Min(-1)
  tarjetasPorUsuario?: number;

  @IsOptional()
  @IsBoolean()
  graficasAvanzadas?: boolean;

  @IsOptional()
  @IsBoolean()
  reportesExportables?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
  
    @IsOptional()
    @IsBoolean()
    allowOverdraft?: boolean;
}
