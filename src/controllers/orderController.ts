import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { OrderQueryInput, ReceiveItemInput, ReceiveAllInput } from '../schemas/order';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

const orderInclude = {
  supplier: true,
  destinationSite: true,
  items: {
    include: { product: true },
  },
};

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, status, supplierId, productId, startDate, endDate, search } = (req as any).parsedQuery as OrderQueryInput;

    const where: any = {};

    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (productId) where.items = { some: { productId } };

    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = new Date(startDate);
      if (endDate) where.orderDate.lte = new Date(endDate);
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      success: true,
      data: orders,
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

    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new AppError('Commande non trouvée', 404);
    }

    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, createdBy: _ignored, ...headerData } = req.body;
    const authUser = (req as any).user as { fullName?: string; username?: string } | undefined;
    const createdBy = authUser?.fullName || authUser?.username || null;

    const order = await prisma.$transaction(async (tx) => {
      // Generate orderNumber: CMD-YYYY-NNNN
      const year = new Date().getFullYear();
      const prefix = `CMD-${year}-`;

      const lastOrder = await tx.order.findFirst({
        where: { orderNumber: { startsWith: prefix } },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      });

      let nextSeq = 1;
      if (lastOrder?.orderNumber) {
        const parts = lastOrder.orderNumber.split('-');
        const lastSeq = parseInt(parts[2], 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }

      const orderNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

      return tx.order.create({
        data: {
          ...headerData,
          orderNumber,
          createdBy,
          items: {
            create: items.map((item: { productId: string; quantity: number; unitPrice?: number }) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice ?? null,
            })),
          },
        },
        include: orderInclude,
      });
    });

    publishCrudEvent('orders', 'inserted', order as any, (req as any).user);

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.update({
      where: { id },
      data: req.body,
      include: orderInclude,
    });

    publishCrudEvent('orders', 'updated', order as any, (req as any).user);

    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const receiveItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id as string;
    const itemId = req.params.itemId as string;
    const { receivedDate, receivedQty, condition, siteId, comment }: ReceiveItemInput = req.body;

    // Récupérer la commande et l'item
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new AppError('Commande non trouvée', 404);
    }

    const item = order.items.find((i) => i.id === itemId);
    if (!item) {
      throw new AppError('Ligne de commande non trouvée', 404);
    }

    if (item.receivedQty !== null) {
      throw new AppError('Cette ligne a déjà été réceptionnée', 400);
    }

    const targetSiteId = siteId || order.destinationSiteId;
    if (!targetSiteId) {
      throw new AppError('Site de destination non défini. Veuillez sélectionner un site.', 400);
    }

    const authUser = (req as any).user as { fullName?: string; username?: string } | undefined;
    const operator = authUser?.fullName || authUser?.username || order.responsible || null;

    const result = await prisma.$transaction(async (tx) => {
      // Mettre à jour l'item
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          receivedQty,
          receivedDate: new Date(receivedDate),
          condition: condition || 'NEW',
        },
      });

      // Créer le mouvement d'entrée
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'IN',
          targetSiteId,
          quantity: receivedQty,
          condition: condition || 'NEW',
          movementDate: new Date(receivedDate),
          operator,
          comment: comment || `Réception commande ${order.orderNumber}`,
        },
      });

      // Mettre à jour le stock
      const quantityField = (condition || 'NEW') === 'NEW' ? 'quantityNew' : 'quantityUsed';

      await tx.stock.upsert({
        where: {
          productId_siteId: {
            productId: item.productId,
            siteId: targetSiteId,
          },
        },
        create: {
          productId: item.productId,
          siteId: targetSiteId,
          [quantityField]: receivedQty,
        },
        update: {
          [quantityField]: { increment: receivedQty },
        },
      });

      // Vérifier si tous les items sont réceptionnés
      const allItems = await tx.orderItem.findMany({
        where: { orderId },
      });

      const allReceived = allItems.every((i) =>
        i.id === itemId ? true : i.receivedQty !== null
      );

      if (allReceived) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'COMPLETED',
            receivedDate: new Date(receivedDate),
          },
        });
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: orderInclude,
      });
    });

    publishCrudEvent('orders', 'updated', result as any, (req as any).user);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const receiveAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id as string;
    const { receivedDate, siteId, comment, items: receivedItems }: ReceiveAllInput = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, destinationSite: true },
    });

    if (!order) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (order.status !== 'PENDING') {
      throw new AppError('Seules les commandes en cours peuvent être réceptionnées', 400);
    }

    const targetSiteId = siteId || order.destinationSiteId;
    if (!targetSiteId) {
      throw new AppError('Site de destination non défini. Veuillez sélectionner un site.', 400);
    }

    const authUser = (req as any).user as { fullName?: string; username?: string } | undefined;
    const operator = authUser?.fullName || authUser?.username || order.responsible || null;

    // Vérifier que tous les items existent et sont en attente
    const pendingItemsMap = new Map(
      order.items.filter((i) => i.receivedQty === null).map((i) => [i.id, i])
    );

    for (const ri of receivedItems) {
      if (!pendingItemsMap.has(ri.itemId)) {
        throw new AppError(`Article ${ri.itemId} non trouvé ou déjà réceptionné`, 400);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const dateObj = new Date(receivedDate);

      for (const ri of receivedItems) {
        const item = pendingItemsMap.get(ri.itemId)!;
        const conditionValue = ri.condition || 'NEW';
        const quantityField = conditionValue === 'NEW' ? 'quantityNew' : 'quantityUsed';

        // Mettre à jour l'item
        await tx.orderItem.update({
          where: { id: ri.itemId },
          data: {
            receivedQty: ri.receivedQty,
            receivedDate: dateObj,
            condition: conditionValue,
          },
        });

        // Créer le mouvement d'entrée
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'IN',
            targetSiteId,
            quantity: ri.receivedQty,
            condition: conditionValue,
            movementDate: dateObj,
            operator,
            comment: comment || `Réception globale commande ${order.orderNumber}`,
          },
        });

        // Mettre à jour le stock
        await tx.stock.upsert({
          where: {
            productId_siteId: {
              productId: item.productId,
              siteId: targetSiteId,
            },
          },
          create: {
            productId: item.productId,
            siteId: targetSiteId,
            [quantityField]: ri.receivedQty,
          },
          update: {
            [quantityField]: { increment: ri.receivedQty },
          },
        });
      }

      // Vérifier si tous les items sont réceptionnés
      const allItems = await tx.orderItem.findMany({
        where: { orderId },
      });

      const allReceived = allItems.every((i) => i.receivedQty !== null);

      if (allReceived) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'COMPLETED',
            receivedDate: dateObj,
          },
        });
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: orderInclude,
      });
    });

    publishCrudEvent('orders', 'updated', result as any, (req as any).user);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (order.status === 'COMPLETED') {
      throw new AppError('Impossible de supprimer une commande terminée', 400);
    }

    const hasReceivedItems = order.items.some((i) => i.receivedQty !== null && i.receivedQty > 0);
    if (hasReceivedItems) {
      throw new AppError('Impossible de supprimer une commande avec des articles déjà réceptionnés', 400);
    }

    await prisma.order.delete({ where: { id } });

    publishCrudEvent('orders', 'deleted', { id }, (req as any).user);

    res.json({ success: true, message: 'Commande supprimée' });
  } catch (error) {
    next(error);
  }
};
