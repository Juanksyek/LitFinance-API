import { IsIn, IsOptional, IsString } from 'class-validator';

export class DeleteSubcuentaDto {
  /**
   * What to do with the remaining balance in the subcuenta.
   * - transfer_to_principal: move remaining balance to main account (principal)
   * - discard: remove the balance (does not affect principal)
   */
  @IsIn(['transfer_to_principal', 'discard'])
  action: 'transfer_to_principal' | 'discard';

  /**
   * Optional note to record in the audit trail.
   */
  @IsOptional()
  @IsString()
  note?: string;
}
