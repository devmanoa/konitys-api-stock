import { Router } from 'express';
import * as assemblyTypeController from '../controllers/assemblyTypeController';
import { validateBody, validateQuery } from '../middleware/validation';
import {
  createAssemblyTypeSchema,
  updateAssemblyTypeSchema,
  querySchema,
} from '../schemas/assemblyTypeSchemas';

const router = Router();

// GET /api/assembly-types/buildable - Max buildable quantity per type
router.get('/buildable', assemblyTypeController.getBuildable);

// GET /api/assembly-types - List all assembly types
router.get('/', validateQuery(querySchema), assemblyTypeController.getAll);

// GET /api/assembly-types/:id - Get assembly type by ID
router.get('/:id', assemblyTypeController.getById);

// POST /api/assembly-types - Create new assembly type
router.post('/', validateBody(createAssemblyTypeSchema), assemblyTypeController.create);

// PUT /api/assembly-types/:id - Update assembly type
router.put('/:id', validateBody(updateAssemblyTypeSchema), assemblyTypeController.update);

// DELETE /api/assembly-types/:id - Delete assembly type
router.delete('/:id', assemblyTypeController.remove);

export default router;
