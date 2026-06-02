import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 20, search, assemblyTypeId } = (req as any).parsedQuery || req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { contact: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    // Filter suppliers that have products linked to a specific assembly type
    if (assemblyTypeId) {
      where.productSuppliers = {
        some: {
          product: {
            assemblyTypes: {
              some: { assemblyTypeId: assemblyTypeId as string },
            },
          },
        },
      };
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          _count: {
            select: { productSuppliers: true, orders: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.supplier.count({ where }),
    ]);

    res.json({
      success: true,
      data: suppliers,
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

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        productSuppliers: {
          include: {
            product: {
              include: {
                assembly: true,
                assemblyTypes: { include: { assemblyType: true } },
              },
            },
          },
        },
        orders: {
          include: {
            items: {
              include: {
                product: true,
                anomalies: { orderBy: { reportedAt: 'desc' } },
              },
            },
            destinationSite: true,
          },
          orderBy: { orderDate: 'desc' },
        },
        contacts: {
          orderBy: { lastName: 'asc' },
        },
      },
    });

    if (!supplier) {
      throw new AppError('Fournisseur non trouvé', 404);
    }

    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /suppliers/:id/reception-anomalies
 * Flat list of every anomaly reported across all of this supplier's orders.
 * Used by the supplier detail page to surface the supplier's reliability.
 */
export const getReceptionAnomalies = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const anomalies = await prisma.orderItemAnomaly.findMany({
      where: { orderItem: { order: { supplierId: id } } },
      orderBy: { reportedAt: 'desc' },
      include: {
        orderItem: {
          include: {
            order: { select: { id: true, orderNumber: true, orderDate: true } },
            product: { select: { id: true, reference: true, description: true, imageUrl: true } },
          },
        },
      },
    });
    res.json({ success: true, data: anomalies });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplier = await prisma.supplier.create({
      data: req.body,
    });

    publishCrudEvent('suppliers', 'inserted', supplier, (req as any).user);

    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const supplier = await prisma.supplier.update({
      where: { id },
      data: req.body,
    });

    publishCrudEvent('suppliers', 'updated', supplier, (req as any).user);

    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    await prisma.supplier.delete({ where: { id } });

    publishCrudEvent('suppliers', 'deleted', { id }, (req as any).user);

    res.json({ success: true, message: 'Fournisseur supprimé' });
  } catch (error) {
    next(error);
  }
};
