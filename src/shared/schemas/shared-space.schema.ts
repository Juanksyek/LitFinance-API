import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedSpaceDocument = SharedSpace & Document;

@Schema({ timestamps: true })
export class SharedSpace {
  @Prop({ required: true, unique: true })
  spaceId: string;

  @Prop({ required: true, index: true })
  ownerUserId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true, enum: ['pareja', 'grupo', 'viaje', 'familia', 'custom'], default: 'grupo' })
  tipo: string;

  @Prop({ default: '' })
  descripcion: string;

  @Prop({ required: true, default: 'MXN' })
  monedaBase: string;

  @Prop({ required: true, enum: ['activo', 'archivado'], default: 'activo', index: true })
  estado: string;

  @Prop({
    type: Object,
    default: {
      splitDefaultMode: 'equal',
      allowPrivateMovements: false,
      allowCategoryCustom: true,
      allowAccountImpact: true,
      maxMembers: 20,
      requireConfirmationForEdits: false,
      showMemberComparisons: true,
    },
  })
  configuracion: {
    splitDefaultMode?: string;
    allowPrivateMovements?: boolean;
    allowCategoryCustom?: boolean;
    allowAccountImpact?: boolean;
    maxMembers?: number;
    requireConfirmationForEdits?: boolean;
    showMemberComparisons?: boolean;
  };
}

export const SharedSpaceSchema = SchemaFactory.createForClass(SharedSpace);
SharedSpaceSchema.index({ ownerUserId: 1, estado: 1 });
