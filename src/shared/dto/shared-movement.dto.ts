import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray,
  ValidateNested, IsBoolean, IsDateString, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MovementContributionDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsNumber()
  @Min(0)
  amountContributed: number;

  @IsEnum(['payer', 'shared_source', 'manual'])
  @IsOptional()
  contributionType?: string;
}

export class MovementSplitDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsNumber()
  @Min(0)
  amountAssigned: number;

  @IsNumber()
  @IsOptional()
  percentage?: number;

  @IsNumber()
  @IsOptional()
  units?: number;

  @IsBoolean()
  @IsOptional()
  included?: boolean;

  @IsEnum(['consumer', 'beneficiary', 'participant'])
  @IsOptional()
  roleInSplit?: string;
}

export class MovementAccountImpactDto {
  @IsBoolean()
  enabled: boolean;

  @IsEnum(['main_account', 'subaccount'])
  @IsOptional()
  destinationType?: string;

  @IsString()
  @IsOptional()
  destinationId?: string;

  @IsEnum(['income', 'expense', 'adjustment'])
  @IsOptional()
  impactType?: string;

  @IsBoolean()
  @IsOptional()
  afectaSaldo?: boolean;
}

export class CreateSharedMovementDto {
  @IsEnum(['expense', 'income', 'adjustment', 'planned', 'recurring', 'goal_contribution'])
  @IsNotEmpty()
  tipo: string;

  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  categoriaId?: string;

  @IsNumber()
  @Min(0.01)
  montoTotal: number;

  @IsString()
  @IsNotEmpty()
  moneda: string;

  @IsDateString()
  @IsNotEmpty()
  fechaMovimiento: string;

  @IsEnum(['equal', 'percentage', 'fixed', 'participants_only', 'units', 'custom'])
  @IsOptional()
  splitMode?: string;

  @IsEnum(['all', 'limited', 'private_summary'])
  @IsOptional()
  visibility?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovementContributionDto)
  contributions: MovementContributionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovementSplitDto)
  splits: MovementSplitDto[];

  @ValidateNested()
  @Type(() => MovementAccountImpactDto)
  @IsOptional()
  accountImpact?: MovementAccountImpactDto;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  linkedRuleId?: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class UpdateSharedMovementDto {
  @IsString()
  @IsOptional()
  titulo?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  categoriaId?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  montoTotal?: number;

  @IsDateString()
  @IsOptional()
  fechaMovimiento?: string;

  @IsEnum(['equal', 'percentage', 'fixed', 'participants_only', 'units', 'custom'])
  @IsOptional()
  splitMode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovementContributionDto)
  @IsOptional()
  contributions?: MovementContributionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovementSplitDto)
  @IsOptional()
  splits?: MovementSplitDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
