import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { ProductQueryInput } from '../schemas/product';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import {
  diffScalars,
  diffAssemblyTypes,
  diffPartCategories,
  diffExternalLinks,
} from '../services/productAudit';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, search, supplyRisk, supplierId, assemblyId, assemblyTypeId, partCategoryId, hasSerialNumber, sortBy, sortOrder } = (req as any).parsedQuery as ProductQueryInput;

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
      where.assemblyTypes = { some: { assemblyTypeId } };
    }

    if (supplierId) {
      where.productSuppliers = {
        some: { supplierId },
      };
    }

    if (partCategoryId) {
      where.partCategories = {
        some: { partCategoryId },
      };
    }

    if (hasSerialNumber !== undefined) {
      where.hasSerialNumber = hasSerialNumber;
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
          assemblyTypes: { include: { assemblyType: true } },
          productSuppliers: productSuppliersInclude as any,
          stocks: {
            include: { site: true },
          },
          partCategories: {
            include: { partCategory: true },
          },
          externalLinks: { orderBy: { position: 'asc' } },
          storageLocation: { include: { site: true, parent: { include: { site: true } } } },
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
        assemblyTypes: { include: { assemblyType: true } },
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
        externalLinks: { orderBy: { position: 'asc' } },
        storageLocation: { include: { site: true, parent: { include: { site: true } } } },
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
    const {
      partCategoryIds,
      assemblyTypes: typesInput,
      externalLinks: linksInput,
      ...data
    } = req.body;
    const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
    const who = {
      id: authUser?.id ?? null,
      name: authUser?.fullName || authUser?.username || null,
    };

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data,
        include: { assembly: true },
      });

      if (partCategoryIds && partCategoryIds.length > 0) {
        await tx.productPartCategory.createMany({
          data: partCategoryIds.map((catId: string) => ({
            productId: created.id,
            partCategoryId: catId,
          })),
        });
      }

      if (Array.isArray(linksInput) && linksInput.length > 0) {
        await tx.productExternalLink.createMany({
          data: linksInput.map((url: string, i: number) => ({
            productId: created.id,
            url,
            position: i,
          })),
        });
      }

      if (Array.isArray(typesInput) && typesInput.length > 0) {
        await tx.productAssemblyType.createMany({
          data: typesInput.map((t: { assemblyTypeId: string; qtyPerUnit?: number }) => ({
            productId: created.id,
            assemblyTypeId: t.assemblyTypeId,
            qtyPerUnit: Math.max(1, Number(t.qtyPerUnit) || 1),
          })),
          skipDuplicates: true,
        });
      }

      // Audit log: a single 'created' entry, then one entry per non-default field
      await tx.productAuditLog.create({
        data: {
          productId: created.id,
          action: 'created',
          changedById: who.id,
          changedByName: who.name,
        },
      });

      return tx.product.findUnique({
        where: { id: created.id },
        include: {
          assembly: true,
          assemblyTypes: { include: { assemblyType: true } },
          partCategories: { include: { partCategory: true } },
          externalLinks: { orderBy: { position: 'asc' } },
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
    const {
      partCategoryIds,
      assemblyTypes: typesInput,
      externalLinks: linksInput,
      ...data
    } = req.body;
    const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
    const who = {
      id: authUser?.id ?? null,
      name: authUser?.fullName || authUser?.username || null,
    };

    const previous = await prisma.product.findUnique({
      where: { id },
      include: {
        assemblyTypes: { include: { assemblyType: true } },
        partCategories: true,
        externalLinks: { orderBy: { position: 'asc' } },
      },
    });
    if (!previous) throw new AppError('Produit non trouvé', 404);

    // Reference data needed by diffs to resolve names from ids
    const [allTypes, allCategories] = await Promise.all([
      prisma.assemblyType.findMany({ select: { id: true, name: true } }),
      prisma.partCategory.findMany({ select: { id: true, name: true } }),
    ]);

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

      if (typesInput !== undefined) {
        await tx.productAssemblyType.deleteMany({ where: { productId: id } });
        if (Array.isArray(typesInput) && typesInput.length > 0) {
          await tx.productAssemblyType.createMany({
            data: typesInput.map((t: { assemblyTypeId: string; qtyPerUnit?: number }) => ({
              productId: id,
              assemblyTypeId: t.assemblyTypeId,
              qtyPerUnit: Math.max(1, Number(t.qtyPerUnit) || 1),
            })),
            skipDuplicates: true,
          });
        }
      }

      if (linksInput !== undefined) {
        await tx.productExternalLink.deleteMany({ where: { productId: id } });
        if (Array.isArray(linksInput) && linksInput.length > 0) {
          await tx.productExternalLink.createMany({
            data: linksInput.map((url: string, i: number) => ({
              productId: id,
              url,
              position: i,
            })),
          });
        }
      }

      // hasSerialNumber transitioning from false to true: spawn one ProductSerialItem
      // per existing unit per site, with serialNumber = null (to be filled later)
      if (data.hasSerialNumber === true && previous.hasSerialNumber === false) {
        const createdById = who.id;
        const createdByName = who.name;
        const stocks = await tx.stock.findMany({ where: { productId: id } });
        const seedRows: {
          productId: string;
          condition: 'NEW' | 'USED';
          siteId: string;
          createdById: string | null;
          createdByName: string | null;
        }[] = [];
        for (const s of stocks) {
          for (let i = 0; i < s.quantityNew; i++) {
            seedRows.push({ productId: id, condition: 'NEW', siteId: s.siteId, createdById, createdByName });
          }
          for (let i = 0; i < s.quantityUsed; i++) {
            seedRows.push({ productId: id, condition: 'USED', siteId: s.siteId, createdById, createdByName });
          }
        }
        if (seedRows.length > 0) {
          await tx.productSerialItem.createMany({ data: seedRows });
        }
      }

      // Audit log — emit one row per detected change
      const auditEntries = [
        ...diffScalars(id, previous as any, data, who),
        ...diffAssemblyTypes(
          id,
          (previous.assemblyTypes as any) || [],
          typesInput,
          allTypes,
          who,
        ),
        ...diffPartCategories(
          id,
          (previous.partCategories || []).map((pc: any) => pc.partCategoryId),
          partCategoryIds,
          allCategories,
          who,
        ),
        ...diffExternalLinks(
          id,
          (previous.externalLinks || []).map((l: any) => l.url),
          linksInput,
          who,
        ),
      ];
      if (auditEntries.length > 0) {
        await tx.productAuditLog.createMany({ data: auditEntries });
      }

      return tx.product.findUnique({
        where: { id },
        include: {
          assembly: true,
          assemblyTypes: { include: { assemblyType: true } },
          partCategories: { include: { partCategory: true } },
          externalLinks: { orderBy: { position: 'asc' } },
        },
      });
    });

    publishCrudEvent('products', 'updated', product as any, (req as any).user);

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const getAuditLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw new AppError('Produit non trouvé', 404);
    const entries = await prisma.productAuditLog.findMany({
      where: { productId: id },
      orderBy: { changedAt: 'desc' },
    });
    res.json({ success: true, data: entries });
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
