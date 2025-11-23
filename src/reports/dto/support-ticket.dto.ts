import { 
  IsString, 
  IsNotEmpty, 
  MaxLength, 
  IsEnum, 
  IsOptional,
  IsBoolean 
} from 'class-validator';
import { TicketStatus } from '../schemas/support-ticket.schema';

// DTO para crear un nuevo ticket
export class CreateTicketDto {
  @IsString()
  @IsNotEmpty({ message: 'El título es requerido' })
  @MaxLength(200, { message: 'El título no puede exceder 200 caracteres' })
  titulo: string;

  @IsString()
  @IsNotEmpty({ message: 'La descripción es requerida' })
  @MaxLength(2000, { message: 'La descripción no puede exceder 2000 caracteres' })
  descripcion: string;
}

// DTO para agregar un mensaje/respuesta al ticket
export class AddMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'El mensaje es requerido' })
  @MaxLength(2000, { message: 'El mensaje no puede exceder 2000 caracteres' })
  mensaje: string;

  @IsBoolean()
  @IsOptional()
  esStaff?: boolean; // Se determinará automáticamente según el rol del usuario
}

// DTO para actualizar el estado del ticket (solo staff)
export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus, { message: 'Estado de ticket inválido' })
  estado: TicketStatus;
}

// DTO para actualizar información del ticket
export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'El título no puede exceder 200 caracteres' })
  titulo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'La descripción no puede exceder 2000 caracteres' })
  descripcion?: string;
}

// DTO para filtros de listado
export class FilterTicketsDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  estado?: TicketStatus;

  @IsString()
  @IsOptional()
  userId?: string;
}
