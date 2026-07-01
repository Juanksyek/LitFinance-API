import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchPaginationQueryDto } from '../../common/dto/search-pagination-query.dto';

export class RecurrentesListQueryDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subcuentaId?: string;
}
