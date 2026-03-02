import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateBlocItemDto } from './create-bloc-item.dto';

export class CreateBlocItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBlocItemDto)
  items: CreateBlocItemDto[];
}
