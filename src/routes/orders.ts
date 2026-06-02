import { Router } from 'express';
import * as orderController from '../controllers/orderController';
import * as orderCommentController from '../controllers/orderCommentController';
import * as orderAttachmentController from '../controllers/orderAttachmentController';
import { validateBody, validateQuery } from '../middleware/validation';
import { createOrderSchema, updateOrderSchema, receiveItemSchema, receiveAllSchema, orderQuerySchema } from '../schemas/order';
import { createProductCommentSchema, updateProductCommentSchema, productCommentQuerySchema } from '../schemas/productComment';

const router = Router();

router.get('/', validateQuery(orderQuerySchema), orderController.getAll);
router.get('/:id', orderController.getById);
router.post('/', validateBody(createOrderSchema), orderController.create);
router.put('/:id', validateBody(updateOrderSchema), orderController.update);
router.post('/:id/items/:itemId/receive', validateBody(receiveItemSchema), orderController.receiveItem);
router.post('/:id/receive-all', validateBody(receiveAllSchema), orderController.receiveAll);
router.delete('/:id', orderController.remove);

// Audit log (modifications timeline)
router.get('/:id/audit-log', orderController.getAuditLog);

// Order attachments
router.get('/:id/attachments', orderAttachmentController.list);
router.post('/:id/attachments', orderAttachmentController.upload.single('file'), orderAttachmentController.create);
router.delete('/:id/attachments/:attachmentId', orderAttachmentController.remove);

// Order comments
router.get('/:id/comments', validateQuery(productCommentQuerySchema), orderCommentController.getAll as any);
router.post('/:id/comments', validateBody(createProductCommentSchema), orderCommentController.create as any);
router.put('/:id/comments/:commentId', validateBody(updateProductCommentSchema), orderCommentController.update as any);
router.delete('/:id/comments/:commentId', orderCommentController.remove as any);

export default router;
