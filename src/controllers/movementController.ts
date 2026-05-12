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
        orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
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
    const data: CreateMovementInput & {
      serialNumbers?: string[];
      serialItemIds?: string[];
      borneNumber?: string;
    } = req.body;
    const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
    const operator = authUser?.fullName || authUser?.username || null;
    const createdById = authUser?.id || null;
    const createdByName = operator;

    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new AppError('Produit non trouvé', 404);

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

      // Serial-tracked products: handle individual items
      if (product.hasSerialNumber) {
        if (data.type === 'IN') {
          const targetSiteId = data.targetSiteId!;
          const numbers = (data.serialNumbers || []).map((s) => s.trim()).filter((s) => s.length > 0);
          // Create one ProductSerialItem per unit, filling with provided numbers, padding with nulls
          const rows: { productId: string; serialNumber: string | null; condition: 'NEW' | 'USED'; siteId: string }[] = [];
          for (let i = 0; i < data.quantity; i++) {
            rows.push({
              productId: data.productId,
              serialNumber: i < numbers.length ? numbers[i] : null,
              condition: data.condition,
              siteId: targetSiteId,
            });
          }
          for (const row of rows) {
            // Use individual create instead of createMany to surface unique violations cleanly
            await tx.productSerialItem.create({
              data: { ...row, status: 'IN_STOCK', createdById, createdByName },
            });
          }
        } else if (data.type === 'OUT' || data.type === 'TRANSFER') {
          const ids = data.serialItemIds || [];
          if (ids.length !== data.quantity) {
            throw new AppError(
              `La quantité (${data.quantity}) ne correspond pas au nombre de numéros de série sélectionnés (${ids.length})`,
              400,
            );
          }
          const items = await tx.productSerialItem.findMany({
            where: { id: { in: ids }, productId: data.productId },
          });
          if (items.length !== ids.length) {
            throw new AppError('Un ou plusieurs numéros de série sélectionnés sont introuvables', 400);
          }
          if (data.type === 'OUT') {
            for (const it of items) {
              await tx.productSerialItem.update({
                where: { id: it.id },
                data: {
                  status: 'OUT',
                  siteId: null,
                  exitedAt: new Date(),
                  borneNumber: data.borneNumber || null,
                },
              });
            }
          } else {
            // TRANSFER: keep IN_STOCK but move siteId
            for (const it of items) {
              await tx.productSerialItem.update({
                where: { id: it.id },
                data: { siteId: data.targetSiteId! },
              });
            }
          }
        }
      }

      return movement;
    });

    publishCrudEvent('stock_movements', 'inserted', result as any, (req as any).user);

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
