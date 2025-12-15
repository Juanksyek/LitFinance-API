
import mongoose from 'mongoose';
import { AppVersion } from '../models/AppVersion';

/**
 * Script para inicializar la configuración de versión
 * Ejecutar con: ts-node src/scripts/initializeVersion.ts
 */
async function initializeVersion() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/litfinance');

    const initialVersion = await AppVersion.create({
      version: '1.0.0',
      platform: 'both',
      isActive: true,
      minRequiredVersion: '1.0.0',
      forceUpdate: false,
      storeUrls: {
        playStore: 'https://play.google.com/store/apps/details?id=com.litfinance.app',
        appStore: 'https://apps.apple.com/app/litfinance/id123456789',
      },
      releaseNotes: 'Versión inicial de LitFinance',
      releaseDate: new Date(),
    });

    console.log('✅ Versión inicial creada:', initialVersion);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error inicializando versión:', error);
    process.exit(1);
  }
}

initializeVersion();