import { Router } from 'express';
import * as locationController from '../controllers/locationController';
import { validateBody, validateQuery } from '../middleware/validation';
import {
  createLocationSchema,
  updateLocationSchema,
  locationQuerySchema,
} from '../schemas/location';

const router = Router();

router.get('/', validateQuery(locationQuerySchema), locationController.getAll);
router.post('/', validateBody(createLocationSchema), locationController.create);
router.put('/:id', validateBody(updateLocationSchema), locationController.update);
router.delete('/:id', locationController.remove);

export default router;
