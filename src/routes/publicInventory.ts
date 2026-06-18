import { Router } from 'express';
import * as publicInventory from '../controllers/publicInventoryController';
import { resolveShareLink, assertInventoryEditable } from '../middleware/inventoryShareLink';
import { rateLimit } from '../middleware/publicRateLimit';

const router = Router();

// Every route below MUST be reachable without Keycloak auth — this router
// is mounted on /public/* in app.ts, BEFORE the global authenticate middleware.

// Reads — light rate limit (30s window, 60 req/window).
const readLimit = rateLimit({ windowMs: 30_000, max: 60 });
// Writes — tighter (60s window, 30 req/window). One operator typing fast
// won't hit this; a leaked link spam-posting will.
const writeLimit = rateLimit({ windowMs: 60_000, max: 30 });

router.get('/inventory/:linkId',                  readLimit, resolveShareLink, publicInventory.resolve);
router.get('/inventory/:linkId/locations',        readLimit, resolveShareLink, publicInventory.listLocations);
router.get('/inventory/:linkId/products',         readLimit, resolveShareLink, publicInventory.searchProducts);
router.get('/inventory/:linkId/products/:productId', readLimit, resolveShareLink, publicInventory.getProduct);
router.get('/inventory/:linkId/check-serial',     readLimit, resolveShareLink, publicInventory.checkSerial);
router.get('/inventory/:linkId/my-recent',        readLimit, resolveShareLink, publicInventory.myRecent);

router.post('/inventory/:linkId/entries',         writeLimit, resolveShareLink, assertInventoryEditable, publicInventory.createEntry);
router.post('/inventory/:linkId/unknowns',        writeLimit, resolveShareLink, assertInventoryEditable, publicInventory.createUnknown);

router.delete('/inventory/:linkId/entries/:entryId',     writeLimit, resolveShareLink, assertInventoryEditable, publicInventory.deleteEntry);
router.delete('/inventory/:linkId/unknowns/:unknownId',  writeLimit, resolveShareLink, assertInventoryEditable, publicInventory.deleteUnknown);

export default router;
