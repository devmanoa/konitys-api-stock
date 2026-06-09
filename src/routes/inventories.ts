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
router.get('/:id/unknowns', inventoryController.listUnknowns);
router.post('/:id/unknowns', inventoryController.createUnknown as any);
router.delete('/:id/unknowns/:unknownId', inventoryController.deleteUnknown);
router.get('/:id/zone-summary', inventoryController.zoneSummary);
router.get('/:id/check-serial', inventoryController.checkSerial);
router.get('/:id/compare', inventoryController.compare);
router.post('/:id/close', inventoryController.close as any);
router.post('/:id/reopen', inventoryController.reopen);
router.post('/:id/apply-corrections', inventoryController.applyCorrections as any);

export default router;
