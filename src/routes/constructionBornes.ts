import { Router } from 'express';
import * as controller from '../controllers/constructionBorneController';
import { validateBody } from '../middleware/validation';
import {
  createConstructionBorneSchema,
  updateConstructionBorneSchema,
} from '../schemas/constructionBorne';

const router = Router();

router.get('/buildable', controller.getBuildable);
router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.post('/', validateBody(createConstructionBorneSchema), controller.create);
router.put('/:id', validateBody(updateConstructionBorneSchema), controller.update);
router.delete('/:id', controller.remove);

export default router;
