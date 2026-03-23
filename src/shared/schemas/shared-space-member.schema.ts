import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedSpaceMemberDocument = SharedSpaceMember & Document;

@Schema({ timestamps: true })
export class SharedSpaceMember {
  @Prop({ required: true, unique: true })
  memberId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, enum: ['owner', 'admin', 'member'], default: 'member' })
  rol: string;

  @Prop({ default: '' })
  alias: string;

  @Prop({ required: true, enum: ['invited', 'active', 'left', 'removed'], default: 'active', index: true })
  estado: string;

  @Prop()
  joinedAt: Date;

  @Prop()
  leftAt: Date;

  @Prop({ type: Object })
  permissionsOverride: Record<string, any>;
}

export const SharedSpaceMemberSchema = SchemaFactory.createForClass(SharedSpaceMember);
SharedSpaceMemberSchema.index({ spaceId: 1, userId: 1 }, { unique: true });
SharedSpaceMemberSchema.index({ spaceId: 1, estado: 1 });
