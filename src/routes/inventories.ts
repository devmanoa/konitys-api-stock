import { Router } from 'express';
import * as inventoryController from '../controllers/inventoryController';

const router = Router();

router.get('/', inventoryController.list);
router.post('/', inventoryController.create);
router.get('/:id', inventoryController.get);
router.get('/:id/entries', inventoryController.listEntries);
router.post('/:id/entries', inventoryController.createEntry as any);
router.patch('/:id/entries/:entryId', inventoryController.updateEntry);
router.delete('/:id/entries/:entryId', inventoryController.deleteEntry);
router.post('/:id/unknowns', inventoryController.createUnknown as any);
router.get('/:id/zone-summary', inventoryController.zoneSummary);
router.get('/:id/check-serial', inventoryController.checkSerial);

export default router;
