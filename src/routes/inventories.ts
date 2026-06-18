import { Router } from 'express';
import * as inventoryController from '../controllers/inventoryController';
import * as shareLinkController from '../controllers/inventoryShareLinkController';
import { requireRole } from '../middleware/auth';

const router = Router();

// Routes accessibles à tout opérateur authentifié.
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
router.get('/:id/find-quantitative', inventoryController.findQuantitative);
router.get('/:id/compare', inventoryController.compare);
router.get('/:id/export', inventoryController.exportXlsx);

// Share links (admin only). Listing is open to any authenticated user so the
// inventory detail page can show "0 lien(s)" without 403. Creation/revocation
// is gated to admin/manager so an operator can't issue a public link.
router.get('/:id/share-links', shareLinkController.list);
router.post('/:id/share-links', requireRole('admin', 'manager') as any, shareLinkController.create as any);

// Routes sensibles: clôture, réouverture et — surtout — application des
// corrections (qui crée des mouvements et modifie les stocks). Réservées
// aux rôles admin/manager pour éviter qu'un opérateur lambda puisse
// vider tout un site en générant des mouvements de correction.
router.post('/:id/close', requireRole('admin', 'manager') as any, inventoryController.close as any);
router.post('/:id/reopen', requireRole('admin', 'manager') as any, inventoryController.reopen as any);
router.post('/:id/apply-corrections', requireRole('admin', 'manager') as any, inventoryController.applyCorrections as any);

export default router;
