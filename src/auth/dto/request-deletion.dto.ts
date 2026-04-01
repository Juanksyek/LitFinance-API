import { IsEmail } from 'class-validator';

export class RequestDeletionDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;
}
