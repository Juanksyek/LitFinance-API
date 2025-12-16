
import { Router } from 'express';
import { versionController } from '../controllers/versionController';
// import { authMiddleware } from '../middleware/auth'; // Si tienes middleware de autenticación

const router = Router();

// Ruta pública para validar versión (sin autenticación requerida)
router.post('/validate', versionController.validateVersion.bind(versionController));

// Ruta pública para obtener última versión
router.get('/latest', versionController.getLatestVersion.bind(versionController));

// Ruta protegida para admin (requiere autenticación y permisos de admin)
// router.post('/config', authMiddleware, adminMiddleware, versionController.createOrUpdateConfig.bind(versionController));
router.post('/config', versionController.createOrUpdateConfig.bind(versionController));

export default router;