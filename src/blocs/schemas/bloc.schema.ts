import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlocDocument = Bloc & Document;

@Schema({ timestamps: true })
export class Bloc {
  @Prop({ required: true, unique: true })
  blocId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop()
  descripcion?: string;

  @Prop()
  icono?: string;

  @Prop({ required: true, enum: ['cuentas', 'compras'] })
  tipo: 'cuentas' | 'compras';
}

export const BlocSchema = SchemaFactory.createForClass(Bloc);
BlocSchema.index({ userId: 1, createdAt: -1 });
