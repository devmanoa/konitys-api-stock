import { Router } from 'express';
import * as controller from '../controllers/borneSectionController';
import { validateBody } from '../middleware/validation';
import {
  createBorneSectionSchema,
  updateBorneSectionSchema,
} from '../schemas/borneSection';

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.post('/', validateBody(createBorneSectionSchema), controller.create);
router.put('/:id', validateBody(updateBorneSectionSchema), controller.update);
router.delete('/:id', controller.remove);

export default router;
