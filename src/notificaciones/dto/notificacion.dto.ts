import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class EnviarNotificacionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsNotEmpty()
  mensaje: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

export class EnviarNotificacionTodosDto {
  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsNotEmpty()
  mensaje: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

export class RegistrarExpoPushTokenDto {
  @IsString()
  @IsNotEmpty()
  expoPushToken: string;
}
