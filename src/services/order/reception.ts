import prisma from '../../config/database';
import { ReceiveItemInput, ReceiveAllInput } from '../../schemas/order';
import { AppError } from '../../middleware/errorHandler';
import { orderInclude } from './orderInclude';
import {
  recordStatusChange,
  recordItemReceived,
  recordAnomaly,
} from './audit';
import { AuthUser } from './types';

// Reception des commandes : mise a jour des lignes, anomalies, mouvements
// de stock, stocks, numeros de serie et recalcul du statut PENDING/PARTIAL/
// COMPLETED. Blocs $transaction deplaces tels quels depuis orderController.

// Reception d'une seule ligne de commande.
// Retourne la commande rechargee + le nombre d'anomalies refusees (pour meta).
export async function receiveOrderItem(
  orderId: string,
  itemId: string,
  input: ReceiveItemInput,
  authUser: AuthUser | undefined,
) {
  const {
    receivedDate,
    receivedQty,
    condition,
    siteId,
    comment,
    anomalies,
  }: ReceiveItemInput = input;

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

  // receivedQty = nombre d'unités qui rentrent en stock (= reçues - refusées).
  // anomalies.REFUSED.quantity n'entrent pas en stock mais sont mémorisées comme
  // anomalie liée à l'OrderItem pour la fiabilité fournisseur.
  const acceptedAnomalies = (anomalies || []).filter((a) => a.decision === 'ACCEPTED');
  const refusedAnomalies = (anomalies || []).filter((a) => a.decision === 'REFUSED');
  const acceptedAnomalyQty = acceptedAnomalies.reduce((s, a) => s + a.quantity, 0);

  if (receivedQty > 0 && acceptedAnomalyQty > receivedQty) {
    throw new AppError(
      "Quantité d'anomalies acceptées supérieure à la quantité reçue",
      400,
    );
  }

  const needsSite = receivedQty > 0;
  const targetSiteId = siteId || order.destinationSiteId;
  if (needsSite && !targetSiteId) {
    throw new AppError('Site de destination non défini. Veuillez sélectionner un site.', 400);
  }

  const operator = authUser?.fullName || authUser?.username || order.responsible || null;

  const result = await prisma.$transaction(async (tx) => {
    // Mettre à jour l'item (receivedQty = ce qui entre vraiment en stock)
    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        receivedQty,
        receivedDate: new Date(receivedDate),
        condition: condition || 'NEW',
      },
    });

    // Enregistrer les anomalies (acceptées comme refusées)
    if (anomalies && anomalies.length > 0) {
      await tx.orderItemAnomaly.createMany({
        data: anomalies.map((a) => ({
          orderItemId: itemId,
          quantity: a.quantity,
          decision: a.decision,
          comment: a.comment,
          photoUrls: a.photoUrls || [],
          reportedById: authUser?.id ?? null,
          reportedByName: operator,
        })),
      });
    }

    if (needsSite && targetSiteId) {
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

      // Si le produit est suivi par n° de série : créer N ProductSerialItem,
      // dont acceptedAnomalyQty avec hasAnomaly = true et le commentaire d'anomalie
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product?.hasSerialNumber) {
        // Pour les unités saines on crée des items "à compléter"
        const healthyCount = receivedQty - acceptedAnomalyQty;
        const rows: any[] = [];
        for (let i = 0; i < healthyCount; i++) {
          rows.push({
            productId: item.productId,
            condition: condition || 'NEW',
            siteId: targetSiteId,
            status: 'IN_STOCK',
            createdById: authUser?.id ?? null,
            createdByName: operator,
          });
        }
        // Pour les unités anomalies acceptées : on stocke avec flag + commentaire
        for (const a of acceptedAnomalies) {
          for (let i = 0; i < a.quantity; i++) {
            rows.push({
              productId: item.productId,
              condition: condition || 'NEW',
              siteId: targetSiteId,
              status: 'IN_STOCK',
              hasAnomaly: true,
              anomalyComment: a.comment,
              createdById: authUser?.id ?? null,
              createdByName: operator,
            });
          }
        }
        if (rows.length > 0) {
          await tx.productSerialItem.createMany({ data: rows });
        }
      }
    }

    // Statut commande : COMPLETED si tous reçus, PARTIAL si au moins un partiellement reçu
    const allItems = await tx.orderItem.findMany({
      where: { orderId },
    });
    const updatedItems = allItems.map((i) =>
      i.id === itemId ? { ...i, receivedQty } : i,
    );
    const allReceived = updatedItems.every((i) => i.receivedQty !== null);
    const anyReceived = updatedItems.some(
      (i) => i.receivedQty !== null && (i.receivedQty || 0) > 0,
    );

    // Audit: item received + per-anomaly entries
    const productLabel =
      (item as any).product?.description || (item as any).product?.reference || item.productId;
    const productInfo = await tx.product.findUnique({
      where: { id: item.productId },
      select: { reference: true, description: true },
    });
    const label =
      productInfo?.description || productInfo?.reference || productLabel;
    const who = {
      id: authUser?.id ?? null,
      name: authUser?.fullName || authUser?.username || null,
    };
    await recordItemReceived(tx, orderId, label, receivedQty, who);
    for (const a of anomalies || []) {
      await recordAnomaly(tx, orderId, label, a, who);
    }

    let statusTransition: { from: string; to: string } | null = null;
    if (allReceived) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', receivedDate: new Date(receivedDate) },
      });
      if (order.status !== 'COMPLETED')
        statusTransition = { from: order.status, to: 'COMPLETED' };
    } else if (anyReceived && order.status !== 'PARTIAL') {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'PARTIAL' },
      });
      statusTransition = { from: order.status, to: 'PARTIAL' };
    }
    if (statusTransition) {
      await recordStatusChange(tx, orderId, statusTransition.from, statusTransition.to, who);
    }

    return tx.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
  });

  return { order: result, refusedAnomalyCount: refusedAnomalies.length };
}

// Reception globale : receptionne toutes les lignes encore en attente
// d'une commande PENDING ou PARTIAL en une seule transaction.
export async function receiveAllOrderItems(
  orderId: string,
  input: ReceiveAllInput,
  authUser: AuthUser | undefined,
) {
  const { receivedDate, siteId, comment, items: receivedItems }: ReceiveAllInput = input;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, destinationSite: true },
  });

  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }

  if (order.status !== 'PENDING' && order.status !== 'PARTIAL') {
    throw new AppError('Seules les commandes en cours ou partiellement reçues peuvent être réceptionnées', 400);
  }

  const anyHasQty = receivedItems.some((ri) => ri.receivedQty > 0);
  const targetSiteId = siteId || order.destinationSiteId;
  if (anyHasQty && !targetSiteId) {
    throw new AppError('Site de destination non défini. Veuillez sélectionner un site.', 400);
  }

  const operator = authUser?.fullName || authUser?.username || order.responsible || null;

  // Vérifier que tous les items existent et sont en attente
  const pendingItemsMap = new Map(
    order.items.filter((i) => i.receivedQty === null).map((i) => [i.id, i])
  );

  for (const ri of receivedItems) {
    if (!pendingItemsMap.has(ri.itemId)) {
      throw new AppError(`Article ${ri.itemId} non trouvé ou déjà réceptionné`, 400);
    }
    const accepted = (ri.anomalies || [])
      .filter((a) => a.decision === 'ACCEPTED')
      .reduce((s, a) => s + a.quantity, 0);
    if (ri.receivedQty > 0 && accepted > ri.receivedQty) {
      throw new AppError(
        "Quantité d'anomalies acceptées supérieure à la quantité reçue sur un article",
        400,
      );
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

      // Enregistrer les anomalies pour cet article
      if (ri.anomalies && ri.anomalies.length > 0) {
        await tx.orderItemAnomaly.createMany({
          data: ri.anomalies.map((a) => ({
            orderItemId: ri.itemId,
            quantity: a.quantity,
            decision: a.decision,
            comment: a.comment,
            photoUrls: a.photoUrls || [],
            reportedById: authUser?.id ?? null,
            reportedByName: operator,
          })),
        });
      }

      // Audit: this item received + per-anomaly
      const productInfo = await tx.product.findUnique({
        where: { id: item.productId },
        select: { reference: true, description: true },
      });
      const itemLabel =
        productInfo?.description || productInfo?.reference || item.productId;
      const itemWho = {
        id: authUser?.id ?? null,
        name: operator,
      };
      await recordItemReceived(tx, orderId, itemLabel, ri.receivedQty, itemWho);
      for (const a of ri.anomalies || []) {
        await recordAnomaly(tx, orderId, itemLabel, a, itemWho);
      }

      if (ri.receivedQty > 0 && targetSiteId) {
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

        // Serial items si applicable (avec flag anomalie pour les unités concernées)
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (product?.hasSerialNumber) {
          const accepted = (ri.anomalies || []).filter((a) => a.decision === 'ACCEPTED');
          const acceptedQty = accepted.reduce((s, a) => s + a.quantity, 0);
          const healthyCount = ri.receivedQty - acceptedQty;
          const rows: any[] = [];
          for (let i = 0; i < healthyCount; i++) {
            rows.push({
              productId: item.productId,
              condition: conditionValue,
              siteId: targetSiteId,
              status: 'IN_STOCK',
              createdById: authUser?.id ?? null,
              createdByName: operator,
            });
          }
          for (const a of accepted) {
            for (let i = 0; i < a.quantity; i++) {
              rows.push({
                productId: item.productId,
                condition: conditionValue,
                siteId: targetSiteId,
                status: 'IN_STOCK',
                hasAnomaly: true,
                anomalyComment: a.comment,
                createdById: authUser?.id ?? null,
                createdByName: operator,
              });
            }
          }
          if (rows.length > 0) {
            await tx.productSerialItem.createMany({ data: rows });
          }
        }
      }
    }

    // Vérifier statut commande
    const allItems = await tx.orderItem.findMany({
      where: { orderId },
    });

    const allReceived = allItems.every((i) => i.receivedQty !== null);
    const anyReceived = allItems.some(
      (i) => i.receivedQty !== null && (i.receivedQty || 0) > 0,
    );

    const allWho = { id: authUser?.id ?? null, name: operator };
    if (allReceived) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          receivedDate: dateObj,
        },
      });
      if (order.status !== 'COMPLETED') {
        await recordStatusChange(tx, orderId, order.status, 'COMPLETED', allWho);
      }
    } else if (anyReceived && order.status !== 'PARTIAL') {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'PARTIAL' },
      });
      await recordStatusChange(tx, orderId, order.status, 'PARTIAL', allWho);
    }

    return tx.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
  });

  return result;
}
