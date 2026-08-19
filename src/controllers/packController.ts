import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import { asyncHandler } from '../utils/asyncHandler';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const packs = await prisma.pack.findMany({
    include: {
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
    },
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: packs });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const pack = await prisma.pack.findUnique({
    where: { id },
    include: {
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
    },
  });

  if (!pack) {
    throw new AppError('Pack non trouvé', 404);
  }

  res.json({ success: true, data: pack });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, items } = req.body;

  const pack = await prisma.$transaction(async (tx) => {
    const newPack = await tx.pack.create({
      data: {
        name,
        description,
        items: {
          create: items.map((item: { productId: string; quantity: number }) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                reference: true,
                description: true,
              },
            },
          },
        },
      },
    });

    return newPack;
  });

  publishCrudEvent('packs', 'inserted', pack as any, (req as any).user);

  res.status(201).json({ success: true, data: pack });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, description, items } = req.body;

  const existingPack = await prisma.pack.findUnique({ where: { id } });
  if (!existingPack) {
    throw new AppError('Pack non trouvé', 404);
  }

  const pack = await prisma.$transaction(async (tx) => {
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    if (items && items.length > 0) {
      await tx.packItem.deleteMany({ where: { packId: id } });

      await tx.packItem.createMany({
        data: items.map((item: { productId: string; quantity: number }) => ({
          packId: id,
          productId: item.productId,
          quantity: item.quantity,
        })),
      });
    }

    const updatedPack = await tx.pack.update({
      where: { id },
      data: updateData,
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                reference: true,
                description: true,
              },
            },
          },
        },
      },
    });

    return updatedPack;
  });

  publishCrudEvent('packs', 'updated', pack as any, (req as any).user);

  res.json({ success: true, data: pack });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const existingPack = await prisma.pack.findUnique({ where: { id } });
  if (!existingPack) {
    throw new AppError('Pack non trouvé', 404);
  }

  await prisma.pack.delete({ where: { id } });

  publishCrudEvent('packs', 'deleted', { id }, (req as any).user);

  res.json({ success: true, message: 'Pack supprimé' });
});
