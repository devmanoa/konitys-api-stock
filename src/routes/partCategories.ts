import { Router } from 'express';
import * as partCategoryController from '../controllers/partCategoryController';
import { validateBody } from '../middleware/validation';
import { createPartCategorySchema, updatePartCategorySchema } from '../schemas/partCategory';

const router = Router();

// GET /part-categories
router.get('/', partCategoryController.getAll as any);

// POST /part-categories
router.post('/', validateBody(createPartCategorySchema) as any, partCategoryController.create as any);

// PUT /part-categories/:id
router.put('/:id', validateBody(updatePartCategorySchema) as any, partCategoryController.update as any);

// DELETE /part-categories/:id
router.delete('/:id', partCategoryController.remove as any);

export default router;
