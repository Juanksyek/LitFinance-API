import { IsString, IsNotEmpty, IsOptional, IsEmail, IsIn, IsBoolean } from 'class-validator';

export class CreateInvitationDto {
  @IsString()
  @IsOptional()
  invitedUserId?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  /** Rol asignado al aceptar: 'admin' | 'member' (default: member) */
  @IsString()
  @IsOptional()
  @IsIn(['admin', 'member'])
  rol?: string;

  /** Mensaje personal adjunto a la invitación */
  @IsString()
  @IsOptional()
  message?: string;

  /**
   * Tipo de invitación:
   * - 'direct': por userId (el invitado recibe notificación in-app)
   * - 'email': se envía correo con link al email indicado
   * - 'link': genera URL/QR compartible (cualquier usuario autenticado puede aceptar)
   * Default: se infiere — si hay invitedUserId→direct, si hay email→email, si ninguno→link
   */
  @IsString()
  @IsOptional()
  @IsIn(['direct', 'email', 'link'])
  invitationType?: string;

  /** Para invitaciones tipo 'link': permitir que múltiples usuarios acepten el mismo link */
  @IsBoolean()
  @IsOptional()
  multiUse?: boolean;

  /**
   * Límite de aceptaciones para links multiUse (0 = sin límite, default).
   * Máximo recomendado: igual a maxMembers del espacio.
   */
  @IsOptional()
  maxUses?: number;
}
