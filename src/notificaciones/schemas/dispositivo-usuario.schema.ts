import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DispositivoUsuarioDocument = DispositivoUsuario & Document;

@Schema({ timestamps: true })
export class DispositivoUsuario {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  token: string;

  @Prop({ required: true })
  plataforma: 'web' | 'android' | 'ios';

  @Prop()
  appVersion?: string;
}

export const DispositivoUsuarioSchema = SchemaFactory.createForClass(DispositivoUsuario);
