import { Router } from 'express';
import * as shareLinkController from '../controllers/inventoryShareLinkController';
import { requireRole } from '../middleware/auth';

const router = Router();

router.delete('/:linkId', requireRole('admin', 'manager') as any, shareLinkController.revoke as any);

export default router;
