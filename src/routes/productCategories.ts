import { Router } from 'express';
import * as productCategoryController from '../controllers/productCategoryController';

const router = Router();

router.get('/', productCategoryController.getAll);
router.post('/', productCategoryController.create);
router.put('/:id', productCategoryController.update);
router.delete('/:id', productCategoryController.remove);

export default router;
