import prisma from '../../config/database';

// Application des corrections d'inventaire.
//
// Code sensible deplace tel quel depuis inventoryController.applyCorrections :
// pour chaque produit avec un ecart non nul, cree un mouvement de stock qui
// aligne le theorique sur le compte, et met a jour la ligne Stock.
//   gap > 0 -> mouvement IN  vers le site de l'inventaire
//   gap < 0 -> mouvement OUT depuis le site de l'inventaire
//
// Les gardes (statut CLOSED, correctionsApplied, siteId requis) restent dans
// le controller. Retourne le nombre de mouvements crees.
export async function applyInventoryCorrections(
  inv: { id: string; name: string; siteId: string | null },
  operator: string,
): Promise<number> {
  const id = inv.id;

  const countedRows = await prisma.inventoryEntry.groupBy({
    by: ['productId'],
    where: { inventoryId: id },
    _sum: { quantity: true },
  });
  const countedMap = new Map<string, number>();
  for (const r of countedRows) countedMap.set(r.productId, r._sum.quantity ?? 0);

  const theoreticalRows = await prisma.stock.groupBy({
    by: ['productId'],
    where: { siteId: inv.siteId! },
    _sum: { quantityNew: true, quantityUsed: true },
  });
  const theoreticalMap = new Map<string, number>();
  for (const r of theoreticalRows) {
    theoreticalMap.set(
      r.productId,
      (r._sum.quantityNew ?? 0) + (r._sum.quantityUsed ?? 0),
    );
  }

  const productIds = Array.from(
    new Set<string>([...countedMap.keys(), ...theoreticalMap.keys()]),
  );
  const now = new Date();
  const commentLabel = `Correction inventaire - ${inv.name}`;

  // Pre-load all relevant Stock rows in ONE query instead of one findFirst
  // per product (was N+1 inside the transaction).
  const existingStocks = await prisma.stock.findMany({
    where: { siteId: inv.siteId!, productId: { in: productIds } },
  });
  const stockMap = new Map<string, typeof existingStocks[number]>();
  for (const s of existingStocks) stockMap.set(s.productId, s);

  // Build the diff to apply, without writing yet.
  type Diff = {
    productId: string;
    isInbound: boolean;
    qty: number;
    // How much to take from each pool when applying an OUT.
    decFromUsed: number;
    decFromNew: number;
  };
  const diffs: Diff[] = [];
  for (const productId of productIds) {
    const counted = countedMap.get(productId) ?? 0;
    const theoretical = theoreticalMap.get(productId) ?? 0;
    const gap = counted - theoretical;
    if (gap === 0) continue;
    const isInbound = gap > 0;
    const qty = Math.abs(gap);
    // For OUT, drain USED first (consistent with "matériel abîmé / perdu"
    // pattern) then NEW. We never go below zero on either pool.
    let decFromUsed = 0;
    let decFromNew = 0;
    if (!isInbound) {
      const current = stockMap.get(productId);
      const used = current?.quantityUsed ?? 0;
      decFromUsed = Math.min(used, qty);
      decFromNew = Math.min(current?.quantityNew ?? 0, qty - decFromUsed);
    }
    diffs.push({ productId, isInbound, qty, decFromUsed, decFromNew });
  }

  await prisma.$transaction(async (tx) => {
    // Batch-create all movements in a single SQL.
    if (diffs.length > 0) {
      await tx.stockMovement.createMany({
        data: diffs.map((d) => ({
          productId: d.productId,
          type: d.isInbound ? 'IN' : 'OUT' as const,
          quantity: d.qty,
          condition: 'NEW' as const,
          movementDate: now,
          operator,
          comment: commentLabel,
          ...(d.isInbound
            ? { targetSiteId: inv.siteId! }
            : { sourceSiteId: inv.siteId! }),
        })),
      });
    }

    // Apply each diff to the Stock row.
    for (const d of diffs) {
      const existing = stockMap.get(d.productId);
      if (existing) {
        await tx.stock.update({
          where: { id: existing.id },
          data: d.isInbound
            ? { quantityNew: { increment: d.qty } }
            : {
                quantityNew: { decrement: d.decFromNew },
                quantityUsed: { decrement: d.decFromUsed },
              },
        });
      } else if (d.isInbound) {
        await tx.stock.create({
          data: {
            productId: d.productId,
            siteId: inv.siteId!,
            quantityNew: d.qty,
            quantityUsed: 0,
          },
        });
      }
      // If !existing && !isInbound: nothing to do, theoretical was already 0.
    }

    await tx.inventory.update({
      where: { id },
      data: {
        correctionsApplied: true,
        correctionsAppliedAt: now,
      },
    });
  });

  return diffs.length;
}
