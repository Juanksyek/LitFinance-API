import { IsString } from 'class-validator';

export class ConfirmDeletionDto {
  @IsString({ message: 'Token requerido' })
  deletionToken: string;
}
