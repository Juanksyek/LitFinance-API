import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchPaginationQueryDto } from '../../common/dto/search-pagination-query.dto';

export class SubcuentaListQueryDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subCuentaId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  soloActivas?: string;
}
