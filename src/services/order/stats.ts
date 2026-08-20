import prisma from '../../config/database';

// KPIs commandes : compteurs par statut + quantite totale en attente.
// Ignore volontairement tous les filtres de la page liste (recherche,
// fournisseur, plage de dates) pour toujours refleter l'etat global.
export async function computeOrderStats() {
  const [byStatus, pendingItems] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.orderItem.findMany({
      where: { order: { status: { in: ['PENDING', 'PARTIAL'] } } },
      select: { quantity: true, receivedQty: true },
    }),
  ]);
  const counts: Record<string, number> = {
    PENDING: 0,
    PARTIAL: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  for (const row of byStatus) counts[row.status] = row._count._all;
  // "Qté attente" = sum of (quantity - receivedQty) on items belonging to
  // orders that are still pending or partially received.
  const pendingQty = pendingItems.reduce(
    (sum, i) => sum + Math.max(0, i.quantity - (i.receivedQty || 0)),
    0,
  );
  return {
    counts,
    pendingQty,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}
