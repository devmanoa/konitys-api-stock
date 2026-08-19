import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';

const templateInclude = {
  supplier: true,
  destinationSite: true,
  items: {
    include: {
      product: {
        select: {
          id: true,
          reference: true,
          description: true,
          imageUrl: true,
        },
      },
    },
  },
  _count: {
    select: { items: true },
  },
};

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const templates = await prisma.orderTemplate.findMany({
    include: templateInclude,
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: templates });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const template = await prisma.orderTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });

  if (!template) {
    throw new AppError('Modèle non trouvé', 404);
  }

  res.json({ success: true, data: template });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { name, supplierId, destinationSiteId, responsible, comment, items } = req.body;

  const template = await prisma.$transaction(async (tx) => {
    return tx.orderTemplate.create({
      data: {
        name,
        supplierId,
        destinationSiteId: destinationSiteId || null,
        responsible: responsible || null,
        comment: comment || null,
        items: {
          create: items.map((item: { productId: string; quantity: number; unitPrice?: number }) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? null,
          })),
        },
      },
      include: templateInclude,
    });
  });

  res.status(201).json({ success: true, data: template });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, supplierId, destinationSiteId, responsible, comment, items } = req.body;

  const existing = await prisma.orderTemplate.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Modèle non trouvé', 404);
  }

  const template = await prisma.$transaction(async (tx) => {
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (supplierId !== undefined) updateData.supplierId = supplierId;
    if (destinationSiteId !== undefined) updateData.destinationSiteId = destinationSiteId;
    if (responsible !== undefined) updateData.responsible = responsible;
    if (comment !== undefined) updateData.comment = comment;

    if (items && items.length > 0) {
      await tx.orderTemplateItem.deleteMany({ where: { templateId: id } });
      await tx.orderTemplateItem.createMany({
        data: items.map((item: { productId: string; quantity: number; unitPrice?: number }) => ({
          templateId: id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? null,
        })),
      });
    }

    return tx.orderTemplate.update({
      where: { id },
      data: updateData,
      include: templateInclude,
    });
  });

  res.json({ success: true, data: template });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const existing = await prisma.orderTemplate.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Modèle non trouvé', 404);
  }

  await prisma.orderTemplate.delete({ where: { id } });

  res.json({ success: true, message: 'Modèle supprimé' });
});
