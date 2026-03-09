import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class TransferEndpointDto {
  @IsIn(['cuenta', 'subcuenta'])
  type: 'cuenta' | 'subcuenta';

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsBoolean()
  principal?: boolean;
}

export class CreateTransferenciaDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.0000001)
  monto: number;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => TransferEndpointDto)
  origen: TransferEndpointDto;

  @IsObject()
  @ValidateNested()
  @Type(() => TransferEndpointDto)
  destino: TransferEndpointDto;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  conceptoId?: string;

  @IsOptional()
  @IsString()
  concepto?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
