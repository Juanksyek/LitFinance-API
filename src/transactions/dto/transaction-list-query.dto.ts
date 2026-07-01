import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class TransactionListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  rango?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fechaInicio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fechaFin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  moneda?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  withTotals?: string;
}
