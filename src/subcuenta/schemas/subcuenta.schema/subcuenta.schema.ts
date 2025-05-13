import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubcuentaDocument = Subcuenta & Document;

@Schema({ timestamps: true })
export class Subcuenta {
  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  cantidad: number;

  @Prop()
  divisaConvertida?: number;

  @Prop()
  tasaCambioUsada?: number;

  @Prop({ required: true })
  moneda: string;

  @Prop()
  simbolo: string;

  @Prop()
  color: string;

  @Prop({ default: null })
  cuentaId?: string;

  @Prop({ default: false })
  afectaCuenta: boolean;

  @Prop({ required: true })
  userId: string;

  @Prop()
  subCuentaId: string;
}

export const SubcuentaSchema = SchemaFactory.createForClass(Subcuenta);