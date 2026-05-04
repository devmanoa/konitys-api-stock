import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { ProductQueryInput } from '../schemas/product';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, search, supplyRisk, supplierId, assemblyId, assemblyTypeId, sortBy, sortOrder } = (req as any).parsedQuery as ProductQueryInput;

    const where: any = {};

    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (supplyRisk) {
      where.supplyRisk = supplyRisk;
    }

    if (assemblyId) {
      where.assemblyId = assemblyId;
    }

    if (assemblyTypeId) {
      where.assemblyTypeId = assemblyTypeId;
    }

    if (supplierId) {
      where.productSuppliers = {
        some: { supplierId },
      };
    }

    // When filtering by supplier, include that supplier's ProductSupplier data
    const productSuppliersInclude = supplierId
      ? {
          include: { supplier: true },
          where: { supplierId },
        }
      : {
          include: { supplier: true },
          where: { isPrimary: true },
          take: 1,
        };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          assembly: {
            include: {
              assemblyTypes: {
                include: { assemblyType: true },
              },
            },
          },
          assemblyType: true,
          productSuppliers: productSuppliersInclude as any,
          stocks: {
            include: { site: true },
          },
          partCategories: {
            include: { partCategory: true },
          },
        },
        orderBy: { [sortBy || 'reference']: sortOrder || 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        assembly: {
          include: {
            assemblyTypes: {
              include: { assemblyType: true },
            },
          },
        },
        assemblyType: true,
        productSuppliers: {
          include: { supplier: true },
        },
        stocks: {
          include: { site: true },
        },
        movements: {
          include: {
            sourceSite: true,
            targetSite: true,
          },
          orderBy: { movementDate: 'desc' },
          take: 10,
        },
        orderItems: {
          include: {
            order: {
              include: { supplier: true },
            },
          },
          orderBy: { order: { orderDate: 'desc' } },
          take: 10,
        },
        partCategories: {
          include: { partCategory: true },
        },
      },
    });

    if (!product) {
      throw new AppError('Produit non trouvé', 404);
    }

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partCategoryIds, ...data } = req.body;

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data,
        include: { assembly: true, assemblyType: true },
      });

      if (partCategoryIds && partCategoryIds.length > 0) {
        await tx.productPartCategory.createMany({
          data: partCategoryIds.map((catId: string) => ({
            productId: created.id,
            partCategoryId: catId,
          })),
        });
      }

      return tx.product.findUnique({
        where: { id: created.id },
        include: {
          assembly: true,
          assemblyType: true,
          partCategories: { include: { partCategory: true } },
        },
      });
    });

    publishCrudEvent('products', 'inserted', product as any, (req as any).user);

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { partCategoryIds, ...data } = req.body;

    const previous = await prisma.product.findUnique({ where: { id } });
    if (!previous) throw new AppError('Produit non trouvé', 404);

    const product = await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data,
      });

      if (partCategoryIds !== undefined) {
        await tx.productPartCategory.deleteMany({ where: { productId: id } });
        if (partCategoryIds.length > 0) {
          await tx.productPartCategory.createMany({
            data: partCategoryIds.map((catId: string) => ({
              productId: id,
              partCategoryId: catId,
            })),
          });
        }
      }

      // hasSerialNumber transitioning from false to true: spawn one ProductSerialItem
      // per existing unit per site, with serialNumber = null (to be filled later)
      if (data.hasSerialNumber === true && previous.hasSerialNumber === false) {
        const stocks = await tx.stock.findMany({ where: { productId: id } });
        const seedRows: { productId: string; condition: 'NEW' | 'USED'; siteId: string }[] = [];
        for (const s of stocks) {
          for (let i = 0; i < s.quantityNew; i++) {
            seedRows.push({ productId: id, condition: 'NEW', siteId: s.siteId });
          }
          for (let i = 0; i < s.quantityUsed; i++) {
            seedRows.push({ productId: id, condition: 'USED', siteId: s.siteId });
          }
        }
        if (seedRows.length > 0) {
          await tx.productSerialItem.createMany({ data: seedRows });
        }
      }

      return tx.product.findUnique({
        where: { id },
        include: {
          assembly: true,
          assemblyType: true,
          partCategories: { include: { partCategory: true } },
        },
      });
    });

    publishCrudEvent('products', 'updated', product as any, (req as any).user);

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    await prisma.product.delete({ where: { id } });

    publishCrudEvent('products', 'deleted', { id }, (req as any).user);

    res.json({ success: true, message: 'Produit supprimé' });
  } catch (error) {
    next(error);
  }
};
