
import mongoose from 'mongoose';
import { AppVersion, IAppVersion } from '../models/AppVersion';

export class VersionService {
  private async isMongoReady(maxWaitMs = 1500): Promise<boolean> {
    if (mongoose.connection.readyState === 1) {
      return true;
    }

    if (mongoose.connection.readyState === 0) {
      return false;
    }

    return await Promise.race([
      mongoose.connection
        .asPromise()
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), maxWaitMs);
      }),
    ]);
  }

  /**
   * Compara dos versiones en formato semántico (x.y.z)
   * @returns -1 si v1 < v2, 0 si v1 = v2, 1 si v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }

    return 0;
  }

  /**
   * Valida si una versión de la app es compatible
   */
  async validateVersion(
    currentVersion: string,
    platform: 'android' | 'ios'
  ): Promise<{
    isValid: boolean;
    isActive: boolean;
    needsUpdate: boolean;
    forceUpdate: boolean;
    message?: string;
    storeUrl?: string;
    latestVersion?: string;
    minRequiredVersion?: string;
    releaseNotes?: string;
  }> {
    try {
      const mongoReady = await this.isMongoReady();
      if (!mongoReady) {
        console.warn('Mongo no está listo para validar la versión móvil. Se permitirá el acceso temporalmente.');
        return {
          isValid: true,
          isActive: true,
          needsUpdate: false,
          forceUpdate: false,
        };
      }

      // Buscar la configuración de versión más reciente
      const latestConfig = await AppVersion.findOne({
        platform: { $in: [platform, 'both'] },
        isActive: true,
      })
        .sort({ releaseDate: -1 })
        .lean()
        .exec();

      if (!latestConfig) {
        // Si no hay configuración, permitir acceso por defecto
        return {
          isValid: true,
          isActive: true,
          needsUpdate: false,
          forceUpdate: false,
        };
      }

      // Comparar versión actual con la mínima requerida
      const comparison = this.compareVersions(
        currentVersion,
        latestConfig.minRequiredVersion
      );

      const isValid = comparison >= 0; // versión actual >= mínima requerida
      const needsUpdate = this.compareVersions(
        currentVersion,
        latestConfig.version
      ) < 0;

      const forceUpdate = !!latestConfig.forceUpdate || !isValid;

      let message = '';
      let storeUrl = '';

      if (forceUpdate) {
        message = latestConfig.forceUpdate
          ? '¡Actualización obligatoria! Por favor actualiza la app para continuar.'
          : 'Tu versión de la app no es compatible. Por favor actualiza a la última versión.';
        
        storeUrl = platform === 'android' 
          ? latestConfig.storeUrls.playStore || ''
          : latestConfig.storeUrls.appStore || '';
      } else if (needsUpdate) {
        message = 'Hay una nueva versión disponible. ¡Actualiza para disfrutar de nuevas funciones!';
        storeUrl = platform === 'android'
          ? latestConfig.storeUrls.playStore || ''
          : latestConfig.storeUrls.appStore || '';
      }

      return {
        isValid,
        isActive: latestConfig.isActive,
        needsUpdate,
        forceUpdate,
        message: message || undefined,
        storeUrl: storeUrl || undefined,
        latestVersion: latestConfig.version,
        minRequiredVersion: latestConfig.minRequiredVersion,
        releaseNotes: needsUpdate ? latestConfig.releaseNotes : undefined,
      };
    } catch (error) {
      console.error('Error validating version:', error);
      // En caso de error, permitir acceso por defecto
      return {
        isValid: true,
        isActive: true,
        needsUpdate: false,
        forceUpdate: false,
      };
    }
  }

  /**
   * Obtener la última versión disponible
   */
  async getLatestVersion(platform?: 'android' | 'ios') {
    const mongoReady = await this.isMongoReady();
    if (!mongoReady) {
      return null;
    }

    const query = platform 
      ? { platform: { $in: [platform, 'both'] }, isActive: true }
      : { isActive: true };

    return await AppVersion.findOne(query).sort({ releaseDate: -1 }).lean().exec();
  }

  /**
   * Crear o actualizar configuración de versión
   */
  async createOrUpdateVersion(versionData: Partial<IAppVersion>) {
    const mongoReady = await this.isMongoReady();
    if (!mongoReady) {
      throw new Error('MongoDB no está disponible para crear o actualizar la configuración de versión');
    }

    if (versionData.version) {
      return await AppVersion.findOneAndUpdate(
        { version: versionData.version },
        versionData,
        { upsert: true, new: true }
      );
    }
    return await AppVersion.create(versionData);
  }
}

export const versionService = new VersionService();
