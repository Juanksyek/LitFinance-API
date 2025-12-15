
import { Request, Response } from 'express';
import { versionService } from '../services/versionService';

export class VersionController {
  /**
   * POST /api/version/validate
   * Valida la versión de la app del usuario
   */
  async validateVersion(req: Request, res: Response) {
    try {
      const { version, platform } = req.body;

      if (!version || !platform) {
        return res.status(400).json({
          success: false,
          message: 'Version and platform are required',
        });
      }

      if (!['android', 'ios'].includes(platform)) {
        return res.status(400).json({
          success: false,
          message: 'Platform must be either "android" or "ios"',
        });
      }

      const validationResult = await versionService.validateVersion(
        version,
        platform
      );

      return res.status(200).json({
        success: true,
        data: validationResult,
      });
    } catch (error) {
      console.error('Error in validateVersion:', error);
      return res.status(500).json({
        success: false,
        message: 'Error validating version',
      });
    }
  }

  /**
   * GET /api/version/latest
   * Obtiene la última versión disponible
   */
  async getLatestVersion(req: Request, res: Response) {
    try {
      const { platform } = req.query;

      const latestVersion = await versionService.getLatestVersion(
        platform as 'android' | 'ios' | undefined
      );

      if (!latestVersion) {
        return res.status(404).json({
          success: false,
          message: 'No version configuration found',
        });
      }

      return res.status(200).json({
        success: true,
        data: latestVersion,
      });
    } catch (error) {
      console.error('Error in getLatestVersion:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching latest version',
      });
    }
  }

  /**
   * POST /api/version/config (Admin only)
   * Crea o actualiza configuración de versión
   */
  async createOrUpdateConfig(req: Request, res: Response) {
    try {
      const versionData = req.body;

      const result = await versionService.createOrUpdateVersion(versionData);

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Version configuration saved successfully',
      });
    } catch (error) {
      console.error('Error in createOrUpdateConfig:', error);
      return res.status(500).json({
        success: false,
        message: 'Error saving version configuration',
      });
    }
  }
}

export const versionController = new VersionController();