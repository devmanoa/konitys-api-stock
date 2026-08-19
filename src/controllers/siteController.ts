import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import { asyncHandler } from '../utils/asyncHandler';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { type, isActive } = req.query;

  const where: any = {};

  if (type) {
    where.type = type;
  }

  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const sites = await prisma.site.findMany({
    where,
    include: {
      _count: {
        select: { stocks: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: sites });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      stocks: {
        include: { product: true },
      },
    },
  });

  if (!site) {
    throw new AppError('Site non trouvé', 404);
  }

  res.json({ success: true, data: site });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const site = await prisma.site.create({
    data: req.body,
  });

  publishCrudEvent('sites', 'inserted', site, (req as any).user);

  res.status(201).json({ success: true, data: site });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const site = await prisma.site.update({
    where: { id },
    data: req.body,
  });

  publishCrudEvent('sites', 'updated', site, (req as any).user);

  res.json({ success: true, data: site });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  await prisma.site.delete({ where: { id } });

  publishCrudEvent('sites', 'deleted', { id }, (req as any).user);

  res.json({ success: true, message: 'Site supprimé' });
});
