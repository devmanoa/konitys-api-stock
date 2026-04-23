import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

const borneInclude = {
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
      section: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const bornes = await prisma.constructionBorne.findMany({
      include: borneInclude,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: bornes });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const borne = await prisma.constructionBorne.findUnique({
      where: { id },
      include: borneInclude,
    });
    if (!borne) throw new AppError('Borne non trouvée', 404);
    res.json({ success: true, data: borne });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, imageUrl, items } = req.body;

    const borne = await prisma.$transaction(async (tx) => {
      return tx.constructionBorne.create({
        data: {
          name,
          description,
          imageUrl,
          items: {
            create: items.map((item: { productId: string; quantity: number; sectionId?: string | null }) => ({
              productId: item.productId,
              quantity: item.quantity,
              sectionId: item.sectionId ?? null,
            })),
          },
        },
        include: borneInclude,
      });
    });

    publishCrudEvent('construction_bornes', 'inserted', borne as any, (req as any).user);
    res.status(201).json({ success: true, data: borne });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, description, imageUrl, items } = req.body;

    const existing = await prisma.constructionBorne.findUnique({ where: { id } });
    if (!existing) throw new AppError('Borne non trouvée', 404);

    const borne = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

      if (items && items.length > 0) {
        await tx.constructionBorneItem.deleteMany({ where: { borneId: id } });
        await tx.constructionBorneItem.createMany({
          data: items.map((item: { productId: string; quantity: number; sectionId?: string | null }) => ({
            borneId: id,
            productId: item.productId,
            quantity: item.quantity,
            sectionId: item.sectionId ?? null,
          })),
        });
      }

      return tx.constructionBorne.update({
        where: { id },
        data: updateData,
        include: borneInclude,
      });
    });

    publishCrudEvent('construction_bornes', 'updated', borne as any, (req as any).user);
    res.json({ success: true, data: borne });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.constructionBorne.findUnique({ where: { id } });
    if (!existing) throw new AppError('Borne non trouvée', 404);

    await prisma.constructionBorne.delete({ where: { id } });
    publishCrudEvent('construction_bornes', 'deleted', { id }, (req as any).user);
    res.json({ success: true, message: 'Borne supprimée' });
  } catch (error) {
    next(error);
  }
};

export const getBuildable = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const bornes = await prisma.constructionBorne.findMany({
      include: borneInclude,
      orderBy: { name: 'asc' },
    });

    const productIds = [...new Set(bornes.flatMap((b) => b.items.map((it) => it.productId)))];

    const stockAggregates = productIds.length
      ? await prisma.stock.groupBy({
          by: ['productId'],
          where: { productId: { in: productIds } },
          _sum: { quantityNew: true, quantityUsed: true },
        })
      : [];

    const stockByProduct = new Map<string, number>();
    for (const agg of stockAggregates) {
      const total = (agg._sum.quantityNew ?? 0) + (agg._sum.quantityUsed ?? 0);
      stockByProduct.set(agg.productId, total);
    }

    const result = bornes.map((borne) => {
      const components = borne.items.map((it) => {
        const currentStock = stockByProduct.get(it.productId) ?? 0;
        return {
          id: it.id,
          productId: it.productId,
          product: it.product,
          required: it.quantity,
          currentStock,
          section: it.section ? it.section.name : null,
        };
      });

      const maxBuildable = components.length
        ? Math.min(
            ...components.map((c) =>
              c.required > 0 ? Math.floor(c.currentStock / c.required) : 0,
            ),
          )
        : 0;

      return {
        id: borne.id,
        name: borne.name,
        description: borne.description,
        imageUrl: borne.imageUrl,
        maxBuildable,
        components,
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
