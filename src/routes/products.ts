import { Router } from 'express';
import * as productController from '../controllers/productController';
import * as productSupplierController from '../controllers/productSupplierController';
import * as productCommentController from '../controllers/productCommentController';
import { validateBody, validateQuery } from '../middleware/validation';
import { createProductSchema, updateProductSchema, productQuerySchema } from '../schemas/product';
import { createProductCommentSchema, updateProductCommentSchema, productCommentQuerySchema } from '../schemas/productComment';

const router = Router();

router.get('/', validateQuery(productQuerySchema), productController.getAll);
router.get('/:id', productController.getById);
router.post('/', validateBody(createProductSchema), productController.create);
router.put('/:id', validateBody(updateProductSchema), productController.update);
router.delete('/:id', productController.remove);

// Product-Supplier links
router.post('/:id/suppliers', productSupplierController.addSupplier);
router.delete('/:id/suppliers/:supplierId', productSupplierController.removeSupplier);
router.put('/:id/suppliers/:supplierId/primary', productSupplierController.setPrimary);
router.get('/:id/price-history', productSupplierController.getPriceHistory);

// Product comments
router.get('/:id/comments', validateQuery(productCommentQuerySchema), productCommentController.getAll as any);
router.post('/:id/comments', validateBody(createProductCommentSchema), productCommentController.create as any);
router.put('/:id/comments/:commentId', validateBody(updateProductCommentSchema), productCommentController.update as any);
router.delete('/:id/comments/:commentId', productCommentController.remove as any);

export default router;
