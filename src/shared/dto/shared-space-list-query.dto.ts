import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchPaginationQueryDto } from '../../common/dto/search-pagination-query.dto';

export class SharedSpaceListQueryDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  estado?: string;
}
