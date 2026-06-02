import { Router } from 'express';
import * as supplierController from '../controllers/supplierController';
import * as supplierContactController from '../controllers/supplierContactController';
import { validateBody, validateQuery } from '../middleware/validation';
import { createSupplierSchema, updateSupplierSchema, supplierQuerySchema } from '../schemas/supplier';
import { createSupplierContactSchema, updateSupplierContactSchema } from '../schemas/supplierContact';

const router = Router();

// Supplier routes
// Company info lookup (must be declared BEFORE /:id so the literal path wins)
router.get('/company-search', supplierController.companySearch);

router.get('/', validateQuery(supplierQuerySchema), supplierController.getAll);
router.get('/:id', supplierController.getById);
router.get('/:id/reception-anomalies', supplierController.getReceptionAnomalies);
router.post('/:id/refresh-company-info', supplierController.refreshCompanyInfo);
router.post('/', validateBody(createSupplierSchema), supplierController.create);
router.put('/:id', validateBody(updateSupplierSchema), supplierController.update);
router.delete('/:id', supplierController.remove);

// Supplier contacts routes
router.get('/:supplierId/contacts', supplierContactController.getAll);
router.get('/:supplierId/contacts/:contactId', supplierContactController.getById);
router.post('/:supplierId/contacts', validateBody(createSupplierContactSchema), supplierContactController.create);
router.put('/:supplierId/contacts/:contactId', validateBody(updateSupplierContactSchema), supplierContactController.update);
router.delete('/:supplierId/contacts/:contactId', supplierContactController.remove);

export default router;
