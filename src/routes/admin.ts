import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import * as adminBackfillController from '../controllers/adminBackfillController';

const router = Router();

// All routes here require the Keycloak `admin` role.
router.use(requireRole('admin') as any);

router.post('/seed-product-categories', adminBackfillController.seedProductCategories as any);

// DB export/import (backup / restore complet)
router.get('/db-export', adminBackfillController.dbExport as any);
router.post('/db-import', adminBackfillController.dbImport as any);

export default router;
