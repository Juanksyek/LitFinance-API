import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubcuentaDocument = Subcuenta & Document;

@Schema({ timestamps: true })
export class Subcuenta {
  @Prop({ required: true })
  nombre: string;

  // Monto en la moneda original de la subcuenta
  @Prop({ required: true })
  cantidad: number;

  // Código ISO de la moneda de esta subcuenta (puede diferir de monedaPrincipal del usuario)
  @Prop({ required: true })
  moneda: string;

  @Prop()
  simbolo: string;

  @Prop()
  color: string;

  @Prop({ default: null })
  cuentaId?: string;

  // Si true, los cambios en esta subcuenta afectan la cuenta principal (con conversión si monedas difieren)
  @Prop({ default: false })
  afectaCuenta: boolean;

  // Define si el saldo inicial fue "nuevo" (sumó a la cuenta) o "apartado" (proviene del saldo existente).
  // Se usa para evitar inflar/deflactar el saldo de la cuenta al crear/eliminar la subcuenta.
  @Prop({ default: 'nuevo' })
  origenSaldo?: 'nuevo' | 'cuenta_principal';

  @Prop({ required: true })
  userId: string;

  @Prop()
  subCuentaId: string;

  @Prop({ default: true })
  activa: boolean;

  // Marca que la subcuenta es un contenedor interno para una Meta y no debe mostrarse
  // en el listado principal de subcuentas del usuario.
  @Prop({ default: false })
  isMeta?: boolean;

  // Indica si fue pausada automáticamente por expiración de premium
  @Prop({ default: false })
  pausadaPorPlan?: boolean;

  // Campos de conversión (se calculan cuando afectaCuenta=true y moneda != monedaPrincipal del usuario)
  @Prop()
  montoConvertido?: number; // Monto convertido a monedaPrincipal del usuario

  @Prop()
  tasaConversion?: number; // Tasa usada para la conversión (histórica)

  @Prop()
  fechaConversion?: Date; // Fecha de la última conversión
}

export const SubcuentaSchema = SchemaFactory.createForClass(Subcuenta);