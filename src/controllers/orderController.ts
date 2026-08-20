import { Request, Response } from 'express';
import prisma from '../config/database';
import { OrderQueryInput } from '../schemas/order';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import { asyncHandler } from '../utils/asyncHandler';
import { orderInclude } from '../services/order/orderInclude';
import { AuthUser } from '../services/order/types';
import { createOrder } from '../services/order/creation';
import { updateOrder, deleteOrder } from '../services/order/mutations';
import { receiveOrderItem, receiveAllOrderItems } from '../services/order/reception';
import { computeOrderStats } from '../services/order/stats';

// Handlers minces : parsing des params, appel du service, envoi de la reponse.
// La logique metier vit dans src/services/order/.

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, status, supplierId, productId, startDate, endDate, search } = (req as any).parsedQuery as OrderQueryInput;

  const where: any = {};

  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (productId) where.items = { some: { productId } };

  if (startDate || endDate) {
    where.orderDate = {};
    if (startDate) where.orderDate.gte = new Date(startDate);
    if (endDate) where.orderDate.lte = new Date(endDate);
  }

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { orderDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  res.json({
    success: true,
    data: orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });

  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }

  res.json({ success: true, data: order });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { items, createdBy: _ignored, ...headerData } = req.body;
  const authUser = (req as any).user as AuthUser | undefined;

  const order = await createOrder(headerData, items, authUser);

  publishCrudEvent('orders', 'inserted', order as any, (req as any).user);

  res.status(201).json({ success: true, data: order });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const authUser = (req as any).user as AuthUser | undefined;

  const order = await updateOrder(id, req.body, authUser);

  publishCrudEvent('orders', 'updated', order as any, (req as any).user);

  res.json({ success: true, data: order });
});

export const receiveItem = asyncHandler(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const itemId = req.params.itemId as string;
  const authUser = (req as any).user as AuthUser | undefined;

  const { order, refusedAnomalyCount } = await receiveOrderItem(orderId, itemId, req.body, authUser);

  publishCrudEvent('orders', 'updated', order as any, (req as any).user);

  res.json({
    success: true,
    data: order,
    meta: { refusedAnomalyCount },
  });
});

export const receiveAll = asyncHandler(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const authUser = (req as any).user as AuthUser | undefined;

  const result = await receiveAllOrderItems(orderId, req.body, authUser);

  publishCrudEvent('orders', 'updated', result as any, (req as any).user);

  res.json({ success: true, data: result });
});

/**
 * GET /orders/stats
 * Global counters for the Orders KPIs: count by status + total pending quantity.
 * Intentionally ignores all list-page filters (search/supplier/date range) so the
 * KPIs always reflect the overall state, not the active tab.
 */
export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const data = await computeOrderStats();
  res.json({ success: true, data });
});

export const getAuditLog = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!order) throw new AppError('Commande non trouvée', 404);
  const entries = await prisma.orderAuditLog.findMany({
    where: { orderId: id },
    orderBy: { changedAt: 'desc' },
  });
  res.json({ success: true, data: entries });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  await deleteOrder(id);

  publishCrudEvent('orders', 'deleted', { id }, (req as any).user);

  res.json({ success: true, message: 'Commande supprimée' });
});
