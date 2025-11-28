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

  @Prop({ required: true })
  userId: string;

  @Prop()
  subCuentaId: string;

  @Prop({ default: true })
  activa: boolean;

  // Campos de conversión (se calculan cuando afectaCuenta=true y moneda != monedaPrincipal del usuario)
  @Prop()
  montoConvertido?: number; // Monto convertido a monedaPrincipal del usuario

  @Prop()
  tasaConversion?: number; // Tasa usada para la conversión (histórica)

  @Prop()
  fechaConversion?: Date; // Fecha de la última conversión
}

export const SubcuentaSchema = SchemaFactory.createForClass(Subcuenta);