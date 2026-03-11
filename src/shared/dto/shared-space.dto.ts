import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsObject, IsNumber, IsBoolean, Min, Max,
} from 'class-validator';

export class CreateSharedSpaceDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEnum(['pareja', 'grupo', 'viaje', 'familia', 'custom'])
  @IsOptional()
  tipo?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  monedaBase: string;

  @IsObject()
  @IsOptional()
  configuracion?: {
    splitDefaultMode?: string;
    allowPrivateMovements?: boolean;
    allowCategoryCustom?: boolean;
    allowAccountImpact?: boolean;
    maxMembers?: number;
    requireConfirmationForEdits?: boolean;
    showMemberComparisons?: boolean;
  };
}

export class UpdateSharedSpaceDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsEnum(['pareja', 'grupo', 'viaje', 'familia', 'custom'])
  @IsOptional()
  tipo?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsObject()
  @IsOptional()
  configuracion?: {
    splitDefaultMode?: string;
    allowPrivateMovements?: boolean;
    allowCategoryCustom?: boolean;
    allowAccountImpact?: boolean;
    maxMembers?: number;
    requireConfirmationForEdits?: boolean;
    showMemberComparisons?: boolean;
  };
}
