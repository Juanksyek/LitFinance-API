import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BlocPartialPaymentDto {
  @IsString()
  itemId: string;

  // amount en moneda original del item
  @IsNumber()
  @Min(0)
  amount: number;
}

export class LiquidarBlocDto {
  @IsArray()
  itemIds: string[];

  @IsIn(['principal', 'cuenta', 'subcuenta'])
  targetType: 'principal' | 'cuenta' | 'subcuenta';

  @ValidateIf((o) => o.targetType !== 'principal')
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsBoolean()
  porItem?: boolean;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BlocPartialPaymentDto)
  partialPayments?: Array<BlocPartialPaymentDto>;

  @IsOptional()
  @IsString()
  nota?: string;

  // Alternativa al header (si el cliente no puede mandar headers fácilmente)
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class LiquidarBlocPreviewDto {
  @IsArray()
  itemIds: string[];

  @IsIn(['principal', 'cuenta', 'subcuenta'])
  targetType: 'principal' | 'cuenta' | 'subcuenta';

  @ValidateIf((o) => o.targetType !== 'principal')
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsBoolean()
  porItem?: boolean;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BlocPartialPaymentDto)
  partialPayments?: Array<BlocPartialPaymentDto>;
}
