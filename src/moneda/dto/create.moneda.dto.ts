import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateMonedaDto {
  @IsString() codigo: string;
  @IsString() nombre: string;
  @IsString() simbolo: string;
  @IsOptional() @IsBoolean() isPrincipal?: boolean;
}