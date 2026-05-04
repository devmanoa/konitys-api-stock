import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

export const addSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;
    const { supplierId, supplierRef, unitPrice, leadTime, productUrl, shippingCost, isPrimary } = req.body;

    // Check if product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError('Produit non trouvé', 404);
    }

    // Check if supplier exists
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      throw new AppError('Fournisseur non trouvé', 404);
    }

    // Check if link already exists
    const existing = await prisma.productSupplier.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });
    if (existing) {
      throw new AppError('Ce fournisseur est déjà lié à ce produit', 400);
    }

    // If isPrimary, unset other primary suppliers
    if (isPrimary) {
      await prisma.productSupplier.updateMany({
        where: { productId },
        data: { isPrimary: false },
      });
    }

    const parsedUnitPrice = unitPrice ? parseFloat(unitPrice) : null;

    const productSupplier = await prisma.productSupplier.create({
      data: {
        productId,
        supplierId,
        supplierRef,
        unitPrice: parsedUnitPrice,
        leadTime,
        productUrl,
        shippingCost: shippingCost ? parseFloat(shippingCost) : null,
        isPrimary: isPrimary || false,
        priceUpdatedAt: parsedUnitPrice != null ? new Date() : null,
      },
      include: { supplier: true },
    });

    // Record price history entry if a price is set and it differs from the last one
    if (parsedUnitPrice != null) {
      const lastEntry = await prisma.productPriceHistory.findFirst({
        where: { productId, supplierId },
        orderBy: { changedAt: 'desc' },
      });
      const previousPrice = lastEntry ? Number(lastEntry.unitPrice) : null;
      if (previousPrice === null || previousPrice !== parsedUnitPrice) {
        const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
        await prisma.productPriceHistory.create({
          data: {
            productId,
            supplierId,
            supplierName: supplier.name,
            unitPrice: parsedUnitPrice,
            changedById: authUser?.id ?? null,
            changedByName: authUser?.fullName || authUser?.username || null,
          },
        });
      }
    }

    res.status(201).json({ success: true, data: productSupplier });
  } catch (error) {
    next(error);
  }
};

export const removeSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;
    const supplierId = req.params.supplierId as string;

    const link = await prisma.productSupplier.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });

    if (!link) {
      throw new AppError('Lien produit-fournisseur non trouvé', 404);
    }

    await prisma.productSupplier.delete({
      where: { productId_supplierId: { productId, supplierId } },
    });

    res.json({ success: true, message: 'Lien supprimé' });
  } catch (error) {
    next(error);
  }
};

export const getPriceHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Produit non trouvé', 404);

    const history = await prisma.productPriceHistory.findMany({
      where: { productId },
      orderBy: { changedAt: 'asc' },
    });

    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

export const setPrimary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.id as string;
    const supplierId = req.params.supplierId as string;

    const link = await prisma.productSupplier.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });

    if (!link) {
      throw new AppError('Lien produit-fournisseur non trouvé', 404);
    }

    // Unset all primary for this product
    await prisma.productSupplier.updateMany({
      where: { productId },
      data: { isPrimary: false },
    });

    // Set this one as primary
    const updated = await prisma.productSupplier.update({
      where: { productId_supplierId: { productId, supplierId } },
      data: { isPrimary: true },
      include: { supplier: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};
