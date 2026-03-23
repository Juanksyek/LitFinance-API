import { IsString, IsNotEmpty, IsEnum, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateAccountImpactDto {
  @IsEnum(['main_account', 'subaccount'])
  @IsNotEmpty()
  destinationType: string;

  @IsString()
  @IsNotEmpty()
  destinationId: string;

  @IsEnum(['income', 'expense', 'adjustment'])
  @IsNotEmpty()
  impactType: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  moneda: string;

  @IsBoolean()
  @IsOptional()
  afectaSaldo?: boolean;
}
