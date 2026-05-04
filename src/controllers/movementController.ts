import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { CreateMovementInput, MovementQueryInput } from '../schemas/movement';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, productId, type, siteId, startDate, endDate, operator } = (req as any).parsedQuery as MovementQueryInput;

    const where: any = {};

    if (productId) where.productId = productId;
    if (type) where.type = type;
    if (operator) where.operator = { contains: operator, mode: 'insensitive' };

    if (siteId) {
      where.OR = [
        { sourceSiteId: siteId },
        { targetSiteId: siteId },
      ];
    }

    if (startDate || endDate) {
      where.movementDate = {};
      if (startDate) where.movementDate.gte = new Date(startDate);
      if (endDate) where.movementDate.lte = new Date(endDate);
    }

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: true,
          sourceSite: true,
          targetSite: true,
        },
        orderBy: { movementDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json({
      success: true,
      data: movements,
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

    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: {
        product: true,
        sourceSite: true,
        targetSite: true,
      },
    });

    if (!movement) {
      throw new AppError('Mouvement non trouvé', 404);
    }

    res.json({ success: true, data: movement });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data: CreateMovementInput = req.body;
    const authUser = (req as any).user as { fullName?: string; username?: string } | undefined;
    const operator = authUser?.fullName || authUser?.username || null;

    // Transaction pour créer le mouvement et mettre à jour les stocks
    const result = await prisma.$transaction(async (tx) => {
      // Créer le mouvement
      const movement = await tx.stockMovement.create({
        data: {
          productId: data.productId,
          type: data.type,
          sourceSiteId: data.sourceSiteId,
          targetSiteId: data.targetSiteId,
          quantity: data.quantity,
          condition: data.condition,
          movementDate: data.movementDate,
          operator,
          comment: data.comment,
        },
        include: {
          product: true,
          sourceSite: true,
          targetSite: true,
        },
      });

      const quantityField = data.condition === 'NEW' ? 'quantityNew' : 'quantityUsed';

      // Mettre à jour le stock source (OUT ou TRANSFER)
      if (data.sourceSiteId) {
        await tx.stock.upsert({
          where: {
            productId_siteId: {
              productId: data.productId,
              siteId: data.sourceSiteId,
            },
          },
          create: {
            productId: data.productId,
            siteId: data.sourceSiteId,
            [quantityField]: -data.quantity, // Sera négatif si le stock n'existait pas
          },
          update: {
            [quantityField]: { decrement: data.quantity },
          },
        });
      }

      // Mettre à jour le stock cible (IN ou TRANSFER)
      if (data.targetSiteId) {
        await tx.stock.upsert({
          where: {
            productId_siteId: {
              productId: data.productId,
              siteId: data.targetSiteId,
            },
          },
          create: {
            productId: data.productId,
            siteId: data.targetSiteId,
            [quantityField]: data.quantity,
          },
          update: {
            [quantityField]: { increment: data.quantity },
          },
        });
      }

      return movement;
    });

    publishCrudEvent('stock_movements', 'inserted', result as any, (req as any).user);

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
