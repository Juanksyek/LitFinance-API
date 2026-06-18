import { IsString, MinLength } from 'class-validator';

export class ResetAccountDto {
  @IsString()
  @MinLength(6)
  currentPassword: string;
}
