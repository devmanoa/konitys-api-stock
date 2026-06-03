import { Router } from 'express';
import * as userController from '../controllers/userController';

const router = Router();

router.get('/', userController.listUsers);
router.get('/known', userController.getKnownUsers as any);
router.post('/sync', userController.syncCurrentUser as any);

export default router;
