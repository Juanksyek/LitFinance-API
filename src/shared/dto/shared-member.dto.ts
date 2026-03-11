import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsEnum(['admin', 'member'])
  @IsNotEmpty()
  rol: string;
}
