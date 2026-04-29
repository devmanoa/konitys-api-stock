import { Router } from 'express';
import productRoutes from './products';
import supplierRoutes from './suppliers';
import siteRoutes from './sites';
import stockRoutes from './stocks';
import movementRoutes from './movements';
import orderRoutes from './orders';
import dashboardRoutes from './dashboard';
import importRoutes from './import';
import exportRoutes from './export';
import assemblyRoutes from './assemblyRoutes';
import assemblyTypeRoutes from './assemblyTypeRoutes';
import uploadRoutes from './upload';
import packRoutes from './packs';
import orderTemplateRoutes from './orderTemplates';
import partCategoryRoutes from './partCategories';
import userRoutes from './users';
import { authenticate } from '../middleware/auth';

const router = Router();

// Health check (public)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply authentication to all routes below
router.use(authenticate as any);

router.use('/products', productRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/sites', siteRoutes);
router.use('/stocks', stockRoutes);
router.use('/movements', movementRoutes);
router.use('/orders', orderRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/import', importRoutes);
router.use('/export', exportRoutes);
router.use('/assemblies', assemblyRoutes);
router.use('/assembly-types', assemblyTypeRoutes);
router.use('/assembly-types/:assemblyTypeId/part-categories', partCategoryRoutes);
router.use('/part-categories', partCategoryRoutes);
router.use('/upload', uploadRoutes);
router.use('/packs', packRoutes);
router.use('/order-templates', orderTemplateRoutes);
router.use('/users', userRoutes);

export default router;
