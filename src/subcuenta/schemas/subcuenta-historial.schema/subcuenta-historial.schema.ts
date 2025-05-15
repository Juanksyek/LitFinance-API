import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubcuentaHistorialDocument = SubcuentaHistorial & Document;

@Schema({ timestamps: true })
export class SubcuentaHistorial {

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  tipo: 'creacion' | 'modificacion' | 'eliminacion' | 'transferencia';

  @Prop()
  descripcion?: string;

  @Prop({ type: Object })
  datosAnteriores?: any;

  @Prop({ type: Object })
  datosActuales?: any;

  @Prop({ required: false })
  subcuentaId: string;

  @Prop({ type: Object })
  datos: any;
}

export const SubcuentaHistorialSchema = SchemaFactory.createForClass(SubcuentaHistorial);
