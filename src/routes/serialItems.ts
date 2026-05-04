import { Router } from 'express';
import * as controller from '../controllers/serialItemController';
import { validateBody, validateQuery } from '../middleware/validation';
import {
  createSerialItemSchema,
  updateSerialItemSchema,
  listSerialItemsQuerySchema,
} from '../schemas/serialItem';

// Mounted both at /products/:id/serial-items (list/create) and /serial-items/:id (update/delete)
const productScopedRouter = Router({ mergeParams: true });
productScopedRouter.get('/', validateQuery(listSerialItemsQuerySchema) as any, controller.listForProduct);
productScopedRouter.post('/', validateBody(createSerialItemSchema), controller.create);

const flatRouter = Router();
flatRouter.put('/:id', validateBody(updateSerialItemSchema), controller.update);
flatRouter.delete('/:id', controller.remove);

export { productScopedRouter as serialItemsForProductRouter, flatRouter as serialItemsRouter };
