import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchPaginationQueryDto } from '../../common/dto/search-pagination-query.dto';

export class SubcuentaHistoryQueryDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  desde?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hasta?: string;
}
