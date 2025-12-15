
import { Schema, model, Document } from 'mongoose';

export interface IAppVersion extends Document {
  version: string; // e.g., "1.0.0"
  platform: 'android' | 'ios' | 'both';
  isActive: boolean;
  minRequiredVersion: string; // versión mínima requerida
  forceUpdate: boolean; // si es true, obliga actualización
  storeUrls: {
    playStore?: string;
    appStore?: string;
  };
  releaseNotes?: string;
  releaseDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppVersionSchema = new Schema<IAppVersion>(
  {
    version: {
      type: String,
      required: true,
      unique: true,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'both'],
      default: 'both',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    minRequiredVersion: {
      type: String,
      required: true,
    },
    forceUpdate: {
      type: Boolean,
      default: false,
    },
    storeUrls: {
      playStore: {
        type: String,
        default: 'https://play.google.com/store/apps/details?id=com.litfinance.app',
      },
      appStore: {
        type: String,
        default: 'https://apps.apple.com/app/litfinance/id123456789',
      },
    },
    releaseNotes: String,
    releaseDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const AppVersion = model<IAppVersion>('AppVersion', AppVersionSchema);