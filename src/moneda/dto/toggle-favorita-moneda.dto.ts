import { IsString, IsNotEmpty } from 'class-validator';

export class ToggleFavoritaMonedaDto {
  @IsString()
  @IsNotEmpty()
  codigoMoneda: string;
}
