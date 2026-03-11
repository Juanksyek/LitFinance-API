import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject } from 'class-validator';

export class CreateSplitRuleDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEnum(['equal', 'percentage', 'fixed', 'units', 'participants_only', 'custom'])
  @IsNotEmpty()
  tipo: string;

  @IsEnum(['default', 'category', 'movement_template'])
  @IsOptional()
  scope?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class UpdateSplitRuleDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsEnum(['equal', 'percentage', 'fixed', 'units', 'participants_only', 'custom'])
  @IsOptional()
  tipo?: string;

  @IsEnum(['default', 'category', 'movement_template'])
  @IsOptional()
  scope?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}
