import { IsString } from 'class-validator';

export class RefreshAuthDto {
  @IsString()
  refreshToken: string;

  @IsString()
  deviceId: string;
}
