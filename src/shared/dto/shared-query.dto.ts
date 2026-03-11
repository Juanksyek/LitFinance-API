import { IsOptional, IsString, IsEnum, IsNumber, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SharedMovementQueryDto {
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(['expense', 'income', 'adjustment', 'planned', 'recurring', 'goal_contribution'])
  @IsOptional()
  tipo?: string;

  @IsEnum(['draft', 'published', 'cancelled', 'corrected'])
  @IsOptional()
  estado?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  createdBy?: string;

  @IsString()
  @IsOptional()
  hasAccountImpact?: string;
}

export class AnalyticsQueryDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsEnum(['week', 'month', 'quarter', 'year'])
  @IsOptional()
  periodType?: string;

  @IsEnum(['day', 'week', 'month'])
  @IsOptional()
  groupBy?: string;
}
