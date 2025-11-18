import { IsString, IsNotEmpty, MaxLength, MinLength, IsEnum, IsOptional, Matches, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReportCategory, ReportPriority } from '../schemas/user-report.schema';

export class CreateUserReportDto {
  @IsString({ message: 'El título debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MinLength(5, { message: 'El título debe tener al menos 5 caracteres' })
  @MaxLength(200, { message: 'El título no puede exceder 200 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' ')) // Sanitización
  @Matches(/^[a-zA-Z0-9\s\-_.,!?¿¡áéíóúÁÉÍÓÚñÑ]+$/, {
    message: 'El título contiene caracteres no permitidos'
  })
  titulo: string;

  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MinLength(10, { message: 'La descripción debe tener al menos 10 caracteres' })
  @MaxLength(2000, { message: 'La descripción no puede exceder 2000 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  descripcion: string;

  @IsOptional()
  @IsEnum(ReportCategory, { message: 'Categoría no válida' })
  categoria?: ReportCategory;

  @IsOptional()
  @IsEnum(ReportPriority, { message: 'Prioridad no válida' })
  prioridad?: ReportPriority;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'La versión no puede exceder 100 caracteres' })
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'El dispositivo no puede exceder 200 caracteres' })
  dispositivo?: string;
}

export class UpdateUserReportStatusDto {
  @IsString({ message: 'El ID del ticket debe ser una cadena' })
  @IsNotEmpty({ message: 'El ID del ticket es obligatorio' })
  @IsUUID('4', { message: 'El formato del ticket ID no es válido' })
  ticketId: string;

  @IsString({ message: 'El nuevo estado debe ser una cadena' })
  @IsNotEmpty({ message: 'El nuevo estado es obligatorio' })
  @Matches(/^(abierto|en_progreso|pausado|resuelto|rechazado|cerrado)$/, {
    message: 'Estado no válido'
  })
  nuevoEstado: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'El comentario no puede exceder 1000 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  comentario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'La respuesta no puede exceder 1000 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  respuestaAdmin?: string;
}