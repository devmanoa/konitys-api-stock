import prisma from '../../config/database';

// Logique de comparaison stock compte vs stock theorique.
// Utilisee par l'endpoint compare et par l'export xlsx (onglet comparaison).

export interface CompareLine {
  productId: string;
  reference: string;
  description: string | null;
  imageUrl: string | null;
  hasSerialNumber: boolean;
  counted: number;
  theoretical: number;
  gap: number;
}

export interface CompareTotals {
  productsCounted: number;
  productsWithGap: number;
  totalSurplus: number;
  totalMissing: number;
}

// Agrege les quantites comptees (saisies d'inventaire) par produit
export async function buildCountedMap(inventoryId: string): Promise<Map<string, number>> {
  const countedRows = await prisma.inventoryEntry.groupBy({
    by: ['productId'],
    where: { inventoryId },
    _sum: { quantity: true },
  });
  const countedMap = new Map<string, number>();
  for (const r of countedRows) countedMap.set(r.productId, r._sum.quantity ?? 0);
  return countedMap;
}

// Agrege le stock theorique (neuf + occasion) par produit.
// Filtre sur le site quand siteId est fourni, sinon somme tous les sites.
export async function buildTheoreticalMap(siteId: string | null): Promise<Map<string, number>> {
  const theoreticalWhere: any = {};
  if (siteId) theoreticalWhere.siteId = siteId;
  const theoreticalRows = await prisma.stock.groupBy({
    by: ['productId'],
    where: theoreticalWhere,
    _sum: { quantityNew: true, quantityUsed: true },
  });
  const theoreticalMap = new Map<string, number>();
  for (const r of theoreticalRows) {
    theoreticalMap.set(
      r.productId,
      (r._sum.quantityNew ?? 0) + (r._sum.quantityUsed ?? 0),
    );
  }
  return theoreticalMap;
}

// Construit les lignes de comparaison triees + les totaux pour un inventaire.
//
// gap = counted - theoretical
//   > 0  surplus on the ground
//   < 0  missing on the ground
export async function buildCompareData(inv: { id: string; siteId: string | null }): Promise<{
  lines: CompareLine[];
  totals: CompareTotals;
}> {
  const countedMap = await buildCountedMap(inv.id);
  const theoreticalMap = await buildTheoreticalMap(inv.siteId);

  const productIds = new Set<string>([...countedMap.keys(), ...theoreticalMap.keys()]);
  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(productIds) } },
    select: {
      id: true,
      reference: true,
      description: true,
      imageUrl: true,
      hasSerialNumber: true,
    },
  });

  const lines: CompareLine[] = products.map((p) => {
    const counted = countedMap.get(p.id) ?? 0;
    const theoretical = theoreticalMap.get(p.id) ?? 0;
    return {
      productId: p.id,
      reference: p.reference,
      description: p.description,
      imageUrl: p.imageUrl,
      hasSerialNumber: p.hasSerialNumber,
      counted,
      theoretical,
      gap: counted - theoretical,
    };
  });

  lines.sort((a, b) => {
    const aGap = Math.abs(a.gap);
    const bGap = Math.abs(b.gap);
    if (aGap !== bGap) return bGap - aGap;
    return a.reference.localeCompare(b.reference);
  });

  const totals: CompareTotals = {
    productsCounted: countedMap.size,
    productsWithGap: lines.filter((l) => l.gap !== 0).length,
    totalSurplus: lines.reduce((s, l) => s + Math.max(0, l.gap), 0),
    totalMissing: lines.reduce((s, l) => s + Math.max(0, -l.gap), 0),
  };

  return { lines, totals };
}
