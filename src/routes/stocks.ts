import { Router } from 'express';
import * as stockController from '../controllers/stockController';

const router = Router();

router.get('/', stockController.getAll);
router.get('/snapshot', stockController.getSnapshot);
router.get('/alerts', stockController.getAlerts);
router.get('/product/:productId', stockController.getByProduct);
router.get('/site/:siteId', stockController.getBySite);

export default router;
