import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import * as adminBackfillController from '../controllers/adminBackfillController';

const router = Router();

// All routes here require the Keycloak `admin` role.
router.use(requireRole('admin') as any);

router.post('/backfill-part-types', adminBackfillController.backfillPartTypes as any);

export default router;
