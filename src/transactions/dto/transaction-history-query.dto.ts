import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class TransactionHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  desde?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hasta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  descripcion?: string;
}
