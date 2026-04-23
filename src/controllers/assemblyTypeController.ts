import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

const itemsInclude = {
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

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 50, search } = (req as any).parsedQuery || req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [assemblyTypes, total] = await Promise.all([
      prisma.assemblyType.findMany({
        where,
        include: {
          _count: {
            select: { assemblies: true },
          },
          partCategories: true,
          ...itemsInclude,
        },
        orderBy: { name: 'asc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.assemblyType.count({ where }),
    ]);

    res.json({
      success: true,
      data: assemblyTypes,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const assemblyType = await prisma.assemblyType.findUnique({
      where: { id },
      include: {
        assemblies: {
          include: {
            assembly: {
              include: {
                products: {
                  include: {
                    stocks: true,
                  },
                },
              },
            },
          },
        },
        partCategories: true,
        ...itemsInclude,
      },
    });

    if (!assemblyType) {
      throw new AppError('Type borne non trouvé', 404);
    }

    const data = {
      ...assemblyType,
      assemblies: assemblyType.assemblies.map((a) => a.assembly),
    };

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, items } = req.body as {
      name: string;
      description?: string | null;
      items?: { productId: string; quantity: number; sectionId?: string | null }[];
    };

    const assemblyType = await prisma.$transaction(async (tx) => {
      return tx.assemblyType.create({
        data: {
          name,
          description,
          items:
            items && items.length > 0
              ? {
                  create: items.map((it) => ({
                    productId: it.productId,
                    quantity: it.quantity,
                    sectionId: it.sectionId ?? null,
                  })),
                }
              : undefined,
        },
        include: itemsInclude,
      });
    });

    publishCrudEvent('assembly_types', 'inserted', assemblyType as any, (req as any).user);

    res.status(201).json({ success: true, data: assemblyType });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, description, items } = req.body as {
      name?: string;
      description?: string | null;
      items?: { productId: string; quantity: number; sectionId?: string | null }[];
    };

    const existing = await prisma.assemblyType.findUnique({ where: { id } });
    if (!existing) throw new AppError('Type borne non trouvé', 404);

    const assemblyType = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      if (items !== undefined) {
        await tx.assemblyTypeItem.deleteMany({ where: { assemblyTypeId: id } });
        if (items.length > 0) {
          await tx.assemblyTypeItem.createMany({
            data: items.map((it) => ({
              assemblyTypeId: id,
              productId: it.productId,
              quantity: it.quantity,
              sectionId: it.sectionId ?? null,
            })),
          });
        }
      }

      return tx.assemblyType.update({
        where: { id },
        data: updateData,
        include: itemsInclude,
      });
    });

    publishCrudEvent('assembly_types', 'updated', assemblyType as any, (req as any).user);

    res.json({ success: true, data: assemblyType });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    // The relations in assembly_assembly_types will be deleted automatically via CASCADE
    await prisma.assemblyType.delete({ where: { id } });

    publishCrudEvent('assembly_types', 'deleted', { id }, (req as any).user);

    res.json({ success: true, message: 'Type borne supprimé' });
  } catch (error) {
    next(error);
  }
};

export const getBuildable = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await prisma.assemblyType.findMany({
      include: itemsInclude,
      orderBy: { name: 'asc' },
    });

    // Keep only types that have at least one component (nomenclature defined)
    const typesWithItems = types.filter((t) => t.items.length > 0);

    const productIds = [
      ...new Set(typesWithItems.flatMap((t) => t.items.map((it) => it.productId))),
    ];

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

    const result = typesWithItems.map((t) => {
      const components = t.items.map((it) => {
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
        id: t.id,
        name: t.name,
        description: t.description,
        imageUrl: null,
        maxBuildable,
        components,
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
