import { IsString, IsNotEmpty, MaxLength, MinLength, IsEmail, Matches, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWebReportDto {
  @IsEmail({}, { message: 'El formato del email no es válido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  @MaxLength(100, { message: 'El email no puede exceder 100 caracteres' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsString({ message: 'El asunto debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El asunto es obligatorio' })
  @MinLength(5, { message: 'El asunto debe tener al menos 5 caracteres' })
  @MaxLength(150, { message: 'El asunto no puede exceder 150 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  @Matches(/^[a-zA-Z0-9\s\-_.,!?¿¡áéíóúÁÉÍÓÚñÑ()]+$/, {
    message: 'El asunto contiene caracteres no permitidos'
  })
  asunto: string;

  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MinLength(10, { message: 'La descripción debe tener al menos 10 caracteres' })
  @MaxLength(1500, { message: 'La descripción no puede exceder 1500 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  descripcion: string;
}

export class UpdateWebReportStatusDto {
  @IsString({ message: 'El ID del ticket debe ser una cadena' })
  @IsNotEmpty({ message: 'El ID del ticket es obligatorio' })
  @IsUUID('4', { message: 'El formato del ticket ID no es válido' })
  ticketId: string;

  @IsString({ message: 'El nuevo estado debe ser una cadena' })
  @IsNotEmpty({ message: 'El nuevo estado es obligatorio' })
  @Matches(/^(pendiente|revisado|respondido|cerrado|spam)$/, {
    message: 'Estado no válido'
  })
  nuevoEstado: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'La respuesta no puede exceder 1000 caracteres' })
  @Transform(({ value }) => value?.trim().replace(/\s+/g, ' '))
  respuestaAdmin?: string;
}

export class ReportFiltersDto {
  @IsOptional()
  @IsString()
  @Matches(/^(abierto|en_progreso|pausado|resuelto|rechazado|cerrado|pendiente|revisado|respondido|spam)$/, {
    message: 'Estado de filtro no válido'
  })
  estado?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha no válido (YYYY-MM-DD)' })
  fechaDesde?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha no válido (YYYY-MM-DD)' })
  fechaHasta?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(baja|media|alta|critica)$/, { message: 'Prioridad no válida' })
  prioridad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Límite no válido' })
  @Matches(/^\d+$/, { message: 'El límite debe ser un número' })
  limite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Página no válida' })
  @Matches(/^\d+$/, { message: 'La página debe ser un número' })
  pagina?: string;
}