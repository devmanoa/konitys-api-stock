import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

const serialInclude = {
  site: { select: { id: true, name: true } },
  product: { select: { id: true, reference: true, description: true } },
} as const;

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.productSerialItem.findUnique({
      where: { id },
      include: serialInclude,
    });
    if (!item) throw new AppError('Numéro de série introuvable', 404);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const listForProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;
    const { status, siteId, condition, search } = (req as any).parsedQuery || req.query;

    const where: any = { productId };
    if (status) where.status = status;
    if (siteId) where.siteId = siteId;
    if (condition) where.condition = condition;
    if (search) {
      where.OR = [
        { serialNumber: { contains: search as string, mode: 'insensitive' } },
        { borneNumber: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.productSerialItem.findMany({
      where,
      include: serialInclude,
      orderBy: [{ status: 'asc' }, { enteredAt: 'desc' }],
    });

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;
    const { serialNumber, condition, siteId, status, borneNumber, comment } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Produit non trouvé', 404);

    const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
    const createdById = authUser?.id || null;
    const createdByName = authUser?.fullName || authUser?.username || null;

    const item = await prisma.productSerialItem.create({
      data: {
        productId,
        serialNumber: serialNumber || null,
        condition,
        siteId: siteId || null,
        status: status || 'IN_STOCK',
        borneNumber: borneNumber || null,
        comment: comment || null,
        createdById,
        createdByName,
      },
      include: serialInclude,
    });

    publishCrudEvent('product_serial_items', 'inserted', item as any, (req as any).user);
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.productSerialItem.findUnique({ where: { id } });
    if (!existing) throw new AppError('Numéro de série non trouvé', 404);

    const data: any = {};
    const body = req.body as Record<string, unknown>;
    for (const k of ['serialNumber', 'condition', 'siteId', 'status', 'borneNumber', 'comment']) {
      if (k in body) {
        const v = body[k];
        data[k] = v === '' ? null : v ?? null;
      }
    }

    // Stamp exitedAt automatically when transitioning to a non-stocked status
    if (data.status && existing.status === 'IN_STOCK' && data.status !== 'IN_STOCK') {
      data.exitedAt = new Date();
      if (!('siteId' in data)) data.siteId = null;
    }
    if (data.status === 'IN_STOCK' && existing.status !== 'IN_STOCK') {
      data.exitedAt = null;
    }

    const item = await prisma.productSerialItem.update({
      where: { id },
      data,
      include: serialInclude,
    });

    publishCrudEvent('product_serial_items', 'updated', item as any, (req as any).user);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.productSerialItem.findUnique({ where: { id } });
    if (!existing) throw new AppError('Numéro de série non trouvé', 404);

    await prisma.productSerialItem.delete({ where: { id } });
    publishCrudEvent('product_serial_items', 'deleted', { id }, (req as any).user);
    res.json({ success: true, message: 'Numéro de série supprimé' });
  } catch (error) {
    next(error);
  }
};
