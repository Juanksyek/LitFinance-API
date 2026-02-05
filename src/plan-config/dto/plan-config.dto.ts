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

  @IsBoolean()
  graficasAvanzadas: boolean;

  @IsBoolean()
  @IsOptional()
  reportesExportables?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}

export class UpdatePlanConfigDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  transaccionesPorDia?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  historicoLimitadoDias?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  recurrentesPorUsuario?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  subcuentasPorUsuario?: number;

  @IsBoolean()
  @IsOptional()
  graficasAvanzadas?: boolean;

  @IsBoolean()
  @IsOptional()
  reportesExportables?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
