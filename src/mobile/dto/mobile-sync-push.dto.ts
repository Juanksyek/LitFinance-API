import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const MOBILE_SYNC_OPERATION_TYPES = [
  'UPDATE_PROFILE',
  'CREATE_TRANSACTION',
  'UPDATE_TRANSACTION',
  'DELETE_TRANSACTION',
  'CREATE_SUBCUENTA',
  'UPDATE_SUBCUENTA',
  'DELETE_SUBCUENTA',
  'CREATE_RECORRENTE',
  'UPDATE_RECORRENTE',
  'DELETE_RECORRENTE',
] as const;

export type MobileSyncOperationType =
  (typeof MOBILE_SYNC_OPERATION_TYPES)[number];

export class MobileSyncOperationDto {
  @IsString()
  @MaxLength(120)
  operationId!: string;

  @IsIn(MOBILE_SYNC_OPERATION_TYPES)
  type!: MobileSyncOperationType;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsDateString()
  createdAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  resourceId?: string;
}

export class MobileSyncPushDto {
  @IsString()
  @MaxLength(120)
  deviceId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MobileSyncOperationDto)
  operations!: MobileSyncOperationDto[];
}
