import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedCategoryDocument = SharedCategory & Document;

@Schema({ timestamps: true })
export class SharedCategory {
  @Prop({ required: true, unique: true })
  categoryId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ default: '' })
  icono: string;

  @Prop({ default: '#6C63FF' })
  color: string;

  @Prop({ default: false })
  isSystem: boolean;

  @Prop({ enum: ['active', 'archived'], default: 'active' })
  estado: string;
}

export const SharedCategorySchema = SchemaFactory.createForClass(SharedCategory);
SharedCategorySchema.index({ spaceId: 1, estado: 1 });
