import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import { asyncHandler } from '../utils/asyncHandler';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 50, search } = (req as any).parsedQuery || req.query;

  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const [assemblies, total] = await Promise.all([
    prisma.assembly.findMany({
      where,
      include: {
        assemblyTypes: {
          include: {
            assemblyType: true,
          },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.assembly.count({ where }),
  ]);

  // Transform to flatten assemblyTypes
  const data = assemblies.map((assembly) => ({
    ...assembly,
    assemblyTypes: assembly.assemblyTypes.map((at) => at.assemblyType),
  }));

  res.json({
    success: true,
    data,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const assembly = await prisma.assembly.findUnique({
    where: { id },
    include: {
      assemblyTypes: {
        include: {
          assemblyType: true,
        },
      },
      products: {
        orderBy: { reference: 'asc' },
      },
    },
  });

  if (!assembly) {
    throw new AppError('Borne non trouvée', 404);
  }

  // Transform to flatten assemblyTypes
  const data = {
    ...assembly,
    assemblyTypes: assembly.assemblyTypes.map((at) => at.assemblyType),
  };

  res.json({ success: true, data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, assemblyTypeIds } = req.body;

  const assembly = await prisma.assembly.create({
    data: {
      name,
      description,
      assemblyTypes: assemblyTypeIds?.length
        ? {
            create: assemblyTypeIds.map((typeId: string) => ({
              assemblyTypeId: typeId,
            })),
          }
        : undefined,
    },
    include: {
      assemblyTypes: {
        include: {
          assemblyType: true,
        },
      },
    },
  });

  // Transform to flatten assemblyTypes
  const data = {
    ...assembly,
    assemblyTypes: assembly.assemblyTypes.map((at) => at.assemblyType),
  };

  publishCrudEvent('assemblies', 'inserted', data, (req as any).user);

  res.status(201).json({ success: true, data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, description, assemblyTypeIds } = req.body;

  // Update assembly and replace assemblyTypes
  await prisma.$transaction(async (tx) => {
    // Delete existing relations
    await tx.assemblyAssemblyType.deleteMany({
      where: { assemblyId: id },
    });

    // Update assembly and create new relations
    await tx.assembly.update({
      where: { id },
      data: {
        name,
        description,
        assemblyTypes: assemblyTypeIds?.length
          ? {
              create: assemblyTypeIds.map((typeId: string) => ({
                assemblyTypeId: typeId,
              })),
            }
          : undefined,
      },
    });
  });

  // Fetch updated assembly
  const assembly = await prisma.assembly.findUnique({
    where: { id },
    include: {
      assemblyTypes: {
        include: {
          assemblyType: true,
        },
      },
    },
  });

  // Transform to flatten assemblyTypes
  const data = {
    ...assembly,
    assemblyTypes: assembly?.assemblyTypes.map((at) => at.assemblyType) || [],
  };

  publishCrudEvent('assemblies', 'updated', data, (req as any).user);

  res.json({ success: true, data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  // Check if there are products with this assembly
  const productsCount = await prisma.product.count({
    where: { assemblyId: id },
  });

  if (productsCount > 0) {
    // Set products' assemblyId to null instead of deleting
    await prisma.product.updateMany({
      where: { assemblyId: id },
      data: { assemblyId: null },
    });
  }

  await prisma.assembly.delete({ where: { id } });

  publishCrudEvent('assemblies', 'deleted', { id }, (req as any).user);

  res.json({ success: true, message: 'Borne supprimée' });
});
