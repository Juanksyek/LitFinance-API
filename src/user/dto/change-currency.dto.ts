import { IsString, IsNotEmpty } from 'class-validator';

export class ChangeCurrencyDto {
  @IsString()
  @IsNotEmpty()
  nuevaMoneda: string;
}
