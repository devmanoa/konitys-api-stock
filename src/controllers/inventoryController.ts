import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Inventory V1.
 *
 * Operator-facing endpoints to record what's physically present in a zone,
 * without ever leaking the theoretical stock. Reconciliation happens in a
 * separate screen / pipeline that's NOT part of V1.
 */

const ENTRY_SOURCES = ['SCAN', 'SEARCH', 'CATEGORY', 'UNKNOWN'] as const;
const ITEM_STATES = ['OK', 'TO_CHECK', 'DAMAGED', 'OUT_OF_SERVICE'] as const;

/**
 * Block any write to an inventory whose status is CLOSED. Throw with 403
 * so the client can surface "Inventaire termine - aucune modification
 * possible" without retrying.
 */
async function assertEditable(inventoryId: string) {
  const inv = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    select: { status: true },
  });
  if (!inv) throw new AppError('Inventaire introuvable', 404);
  if (inv.status === 'CLOSED') {
    throw new AppError('Inventaire clôturé : aucune saisie possible', 403);
  }
}

// GET /inventories
export const list = asyncHandler(async (_req: Request, res: Response) => {
  const inventories = await prisma.inventory.findMany({
    include: {
      site: true,
      _count: { select: { entries: true, unknowns: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  res.json({ success: true, data: inventories });
});

// GET /inventories/:id
export const get = asyncHandler(async (req: Request, res: Response) => {
  const inventory = await prisma.inventory.findUnique({
    where: { id: String(req.params.id) },
    include: {
      site: true,
      _count: { select: { entries: true, unknowns: true } },
    },
  });
  if (!inventory) throw new AppError('Inventaire introuvable', 404);
  res.json({ success: true, data: inventory });
});

// POST /inventories
export const create = asyncHandler(async (req: Request, res: Response) => {
  const { name, siteId } = (req.body || {}) as { name?: string; siteId?: string };
  if (!name?.trim()) throw new AppError('Nom de l\'inventaire requis', 400);
  const inventory = await prisma.inventory.create({
    data: {
      name: name.trim(),
      siteId: siteId || null,
    },
  });
  res.status(201).json({ success: true, data: inventory });
});

// GET /inventories/:id/entries?locationId=...&limit=...
//
// Returns the latest entries first. When `locationId` is given we filter on
// it; otherwise we return entries across the whole inventory.
export const listEntries = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const locationId = (req.query.locationId as string) || undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 200);

  const entries = await prisma.inventoryEntry.findMany({
    where: {
      inventoryId: id!,
      ...(locationId ? { locationId } : {}),
    },
    include: {
      product: {
        select: { id: true, reference: true, description: true, imageUrl: true, hasSerialNumber: true },
      },
      location: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ success: true, data: entries });
});

// POST /inventories/:id/entries
// Body: { productId, locationId?, quantity?, serialNumber?, state?, comment?, photoUrl?, source? }
//
// Duplicate detection is reported but doesn't block — the client decides
// whether to confirm or replace.
export const createEntry = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id);
  await assertEditable(id);
  const {
    productId,
    locationId,
    quantity,
    serialNumber,
    state,
    comment,
    photoUrl,
    source,
  } = (req.body || {}) as {
    productId?: string;
    locationId?: string | null;
    quantity?: number;
    serialNumber?: string | null;
    state?: string;
    comment?: string | null;
    photoUrl?: string | null;
    source?: string;
  };

  if (!productId) throw new AppError('productId requis', 400);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError('Produit introuvable', 404);

  const qty = Math.max(1, Number(quantity ?? 1) || 1);
  const trimmedSerial = serialNumber?.trim() || null;
  const finalState = (ITEM_STATES.includes(state as any) ? state : 'OK') as
    typeof ITEM_STATES[number];
  const finalSource = (ENTRY_SOURCES.includes(source as any) ? source : 'SEARCH') as
    typeof ENTRY_SOURCES[number];

  const entry = await prisma.inventoryEntry.create({
    data: {
      inventoryId: id!,
      productId,
      locationId: locationId || null,
      quantity: product.hasSerialNumber ? 1 : qty,
      serialNumber: trimmedSerial,
      state: finalState,
      comment: comment || null,
      photoUrl: photoUrl || null,
      source: finalSource,
      operatorId: req.user?.id || null,
      operatorName: req.user?.fullName || req.user?.username || null,
    },
    include: {
      product: {
        select: { id: true, reference: true, description: true, imageUrl: true, hasSerialNumber: true },
      },
      location: { select: { id: true, name: true } },
    },
  });

  res.status(201).json({ success: true, data: entry });
});

// PATCH /inventories/:id/entries/:entryId — used to "replace quantity" for a
// quantitative duplicate, or to fix a typo.
export const updateEntry = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await assertEditable(id);
  const entryId = String(req.params.entryId);
  const { quantity, state, comment } = (req.body || {}) as {
    quantity?: number;
    state?: string;
    comment?: string | null;
  };

  const data: any = {};
  if (quantity !== undefined) data.quantity = Math.max(1, Number(quantity) || 1);
  if (state !== undefined && ITEM_STATES.includes(state as any)) data.state = state;
  if (comment !== undefined) data.comment = comment;

  const entry = await prisma.inventoryEntry.update({
    where: { id: entryId },
    data,
  });
  res.json({ success: true, data: entry });
});

// DELETE /inventories/:id/entries/:entryId
export const deleteEntry = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const entryId = String(req.params.entryId);
  await assertEditable(id);
  // Refuse cross-inventory IDOR: the entry must belong to the path id.
  const entry = await prisma.inventoryEntry.findUnique({
    where: { id: entryId },
    select: { inventoryId: true },
  });
  if (!entry || entry.inventoryId !== id) {
    throw new AppError('Saisie introuvable', 404);
  }
  await prisma.inventoryEntry.delete({ where: { id: entryId } });
  res.json({ success: true });
});

// GET /inventories/:id/unknowns?locationId=...
export const listUnknowns = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const locationId = (req.query.locationId as string) || undefined;
  const unknowns = await prisma.inventoryUnknownEntry.findMany({
    where: {
      inventoryId: id,
      ...(locationId ? { locationId } : {}),
    },
    include: {
      location: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: unknowns });
});

// DELETE /inventories/:id/unknowns/:unknownId
export const deleteUnknown = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const unknownId = String(req.params.unknownId);
  await assertEditable(id);
  const entry = await prisma.inventoryUnknownEntry.findUnique({
    where: { id: unknownId },
    select: { inventoryId: true },
  });
  if (!entry || entry.inventoryId !== id) {
    throw new AppError('Saisie introuvable', 404);
  }
  await prisma.inventoryUnknownEntry.delete({ where: { id: unknownId } });
  res.json({ success: true });
});

// POST /inventories/:id/unknowns
// Body: { description, category?, quantity?, comment?, photoUrl?, locationId? }
export const createUnknown = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id);
  await assertEditable(id);
  const { description, category, quantity, comment, photoUrl, locationId } =
    (req.body || {}) as {
      description?: string;
      category?: string;
      quantity?: number;
      comment?: string;
      photoUrl?: string;
      locationId?: string;
    };
  if (!description?.trim()) throw new AppError('Description requise', 400);
  const entry = await prisma.inventoryUnknownEntry.create({
    data: {
      inventoryId: id!,
      locationId: locationId || null,
      description: description.trim(),
      category: category || null,
      quantity: Math.max(1, Number(quantity ?? 1) || 1),
      comment: comment || null,
      photoUrl: photoUrl || null,
      operatorId: req.user?.id || null,
      operatorName: req.user?.fullName || req.user?.username || null,
    },
  });
  res.status(201).json({ success: true, data: entry });
});

// GET /inventories/:id/zone-summary?locationId=...
//
// Lightweight aggregate for the "Terminer la zone" screen. NEVER includes
// theoretical stock or gaps.
export const zoneSummary = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const locationId = (req.query.locationId as string) || undefined;
  if (!locationId) throw new AppError('locationId requis', 400);

  const [entryCount, unknownCount, commentCount] = await Promise.all([
    prisma.inventoryEntry.count({ where: { inventoryId: id!, locationId } }),
    prisma.inventoryUnknownEntry.count({ where: { inventoryId: id!, locationId } }),
    prisma.inventoryEntry.count({
      where: { inventoryId: id!, locationId, NOT: { comment: null } },
    }),
  ]);

  res.json({
    success: true,
    data: { entryCount, unknownCount, commentCount },
  });
});

// GET /inventories/:id/check-serial?productId=...&serial=...
// Used by the client to flag a duplicate before posting the entry.
export const checkSerial = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const productId = req.query.productId as string;
  const serial = (req.query.serial as string)?.trim();
  if (!productId || !serial) {
    return res.json({ success: true, data: { duplicate: false } });
  }
  const existing = await prisma.inventoryEntry.findFirst({
    where: { inventoryId: id, productId, serialNumber: serial },
    select: { id: true, createdAt: true, operatorName: true },
  });
  res.json({ success: true, data: { duplicate: !!existing, existing } });
});

// GET /inventories/:id/find-quantitative?productId=...&locationId=...
// Returns the existing quantitative entry (id + quantity) if the operator
// already counted this product in this zone. Used by the client to offer
// "Add" or "Replace" instead of silently creating a duplicate.
//
// Previously the client was fetching the last 200 entries and filtering
// client-side, which broke once a zone had more than 200 saisies.
export const findQuantitative = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const productId = req.query.productId as string;
  const locationId = (req.query.locationId as string) || null;
  if (!productId) {
    return res.json({ success: true, data: null });
  }
  const existing = await prisma.inventoryEntry.findFirst({
    where: {
      inventoryId: id,
      productId,
      ...(locationId ? { locationId } : { locationId: null }),
    },
    select: { id: true, quantity: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: existing });
});

// POST /inventories/:id/close
// Lock further saisies. Reversible via /reopen.
export const close = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id);
  const inv = await prisma.inventory.findUnique({ where: { id } });
  if (!inv) throw new AppError('Inventaire introuvable', 404);
  if (inv.status === 'CLOSED') {
    return res.json({ success: true, data: inv });
  }
  const updated = await prisma.inventory.update({
    where: { id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedByName: req.user?.fullName || req.user?.username || null,
    },
  });
  res.json({ success: true, data: updated });
});

// POST /inventories/:id/reopen
export const reopen = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const updated = await prisma.inventory.update({
    where: { id },
    data: {
      status: 'DRAFT',
      closedAt: null,
      closedByName: null,
    },
  });
  res.json({ success: true, data: updated });
});

interface CompareLine {
  productId: string;
  reference: string;
  description: string | null;
  imageUrl: string | null;
  hasSerialNumber: boolean;
  counted: number;
  theoretical: number;
  gap: number;
}

// GET /inventories/:id/compare
//
// Aggregate counted (inventory entries) versus theoretical (stocks table)
// per product. Theoretical stock is filtered on the inventory's siteId when
// set, otherwise it sums every site.
//
// gap = counted - theoretical
//   > 0  surplus on the ground
//   < 0  missing on the ground
export const compare = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const inv = await prisma.inventory.findUnique({ where: { id } });
  if (!inv) throw new AppError('Inventaire introuvable', 404);

  const countedRows = await prisma.inventoryEntry.groupBy({
    by: ['productId'],
    where: { inventoryId: id },
    _sum: { quantity: true },
  });
  const countedMap = new Map<string, number>();
  for (const r of countedRows) countedMap.set(r.productId, r._sum.quantity ?? 0);

  const theoreticalWhere: any = {};
  if (inv.siteId) theoreticalWhere.siteId = inv.siteId;
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

  const totals = {
    productsCounted: countedMap.size,
    productsWithGap: lines.filter((l) => l.gap !== 0).length,
    totalSurplus: lines.reduce((s, l) => s + Math.max(0, l.gap), 0),
    totalMissing: lines.reduce((s, l) => s + Math.max(0, -l.gap), 0),
  };

  res.json({
    success: true,
    data: { inventory: inv, lines, totals },
  });
});

// POST /inventories/:id/apply-corrections
//
// For each product with a non-zero gap, create a stock movement that aligns
// theoretical with counted, and update the Stock row accordingly.
//   gap > 0 -> IN  movement to the inventory's site
//   gap < 0 -> OUT movement from the inventory's site
// Idempotent via `correctionsApplied` on the inventory.
export const applyCorrections = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id);
  const inv = await prisma.inventory.findUnique({ where: { id } });
  if (!inv) throw new AppError('Inventaire introuvable', 404);
  if (inv.status !== 'CLOSED') {
    throw new AppError("Cloturez l'inventaire avant de generer les corrections", 400);
  }
  if (inv.correctionsApplied) {
    throw new AppError('Les corrections ont deja ete appliquees pour cet inventaire', 409);
  }
  if (!inv.siteId) {
    throw new AppError(
      "L'inventaire doit etre rattache a un site pour generer les mouvements",
      400,
    );
  }

  const countedRows = await prisma.inventoryEntry.groupBy({
    by: ['productId'],
    where: { inventoryId: id },
    _sum: { quantity: true },
  });
  const countedMap = new Map<string, number>();
  for (const r of countedRows) countedMap.set(r.productId, r._sum.quantity ?? 0);

  const theoreticalRows = await prisma.stock.groupBy({
    by: ['productId'],
    where: { siteId: inv.siteId },
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
  const operator = req.user?.fullName || req.user?.username || 'Systeme';
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

  const movementsCreated = diffs.length;

  res.json({ success: true, data: { movementsCreated } });
});

// GET /inventories/:id/export?tab=entries|unknowns|compare&filter=gap|surplus|missing|all
//
// Streams an .xlsx of the requested tab. The shape mirrors what the UI shows.
// Compare uses the same aggregation as the compare endpoint; the filter param
// matches the filter pills on the UI ("Avec écart" / "Surplus" / "Manquants" /
// "Tout").
export const exportXlsx = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const tabParam = String(req.query.tab || 'entries');
  const filterParam = String(req.query.filter || 'gap');

  const inv = await prisma.inventory.findUnique({
    where: { id },
    include: { site: true },
  });
  if (!inv) throw new AppError('Inventaire introuvable', 404);

  const safeName = (inv.name || 'inventaire')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 60);

  let rows: any[] = [];
  let sheetName = 'Inventaire';
  let suffix = 'entries';

  if (tabParam === 'unknowns') {
    sheetName = 'Produits non trouves';
    suffix = 'non_trouves';
    const unknowns = await prisma.inventoryUnknownEntry.findMany({
      where: { inventoryId: id },
      include: { location: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    rows = unknowns.map((u) => ({
      Date: new Date(u.createdAt).toLocaleString('fr-FR'),
      Description: u.description,
      Categorie: u.category || '',
      Zone: u.location?.name || '',
      Quantite: u.quantity,
      Commentaire: u.comment || '',
      Operateur: u.operatorName || '',
    }));
  } else if (tabParam === 'compare') {
    sheetName = 'Comparaison';
    suffix = 'comparaison';

    const countedRows = await prisma.inventoryEntry.groupBy({
      by: ['productId'],
      where: { inventoryId: id },
      _sum: { quantity: true },
    });
    const countedMap = new Map<string, number>();
    for (const r of countedRows) countedMap.set(r.productId, r._sum.quantity ?? 0);

    const theoreticalWhere: any = {};
    if (inv.siteId) theoreticalWhere.siteId = inv.siteId;
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

    const productIds = new Set<string>([...countedMap.keys(), ...theoreticalMap.keys()]);
    const products = await prisma.product.findMany({
      where: { id: { in: Array.from(productIds) } },
      select: { id: true, reference: true, description: true },
    });

    const allLines = products.map((p) => {
      const counted = countedMap.get(p.id) ?? 0;
      const theoretical = theoreticalMap.get(p.id) ?? 0;
      return {
        reference: p.reference,
        description: p.description || '',
        counted,
        theoretical,
        gap: counted - theoretical,
      };
    });

    const lines = allLines.filter((l) => {
      if (filterParam === 'all') return true;
      if (filterParam === 'gap') return l.gap !== 0;
      if (filterParam === 'surplus') return l.gap > 0;
      if (filterParam === 'missing') return l.gap < 0;
      return true;
    });
    lines.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    rows = lines.map((l) => ({
      Reference: l.reference,
      Description: l.description,
      Compte: l.counted,
      Theorique: l.theoretical,
      Ecart: l.gap,
    }));
  } else {
    sheetName = 'Saisies';
    suffix = 'saisies';
    const entries = await prisma.inventoryEntry.findMany({
      where: { inventoryId: id },
      include: {
        product: { select: { reference: true, description: true, hasSerialNumber: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    rows = entries.map((e) => ({
      Date: new Date(e.createdAt).toLocaleString('fr-FR'),
      Reference: e.product.reference,
      Description: e.product.description || '',
      Zone: e.location?.name || '',
      Quantite: e.product.hasSerialNumber ? 1 : e.quantity,
      'N° serie': e.serialNumber || '',
      Etat: e.state,
      Commentaire: e.comment || '',
      Operateur: e.operatorName || '',
    }));
  }

  // Build the workbook even when rows is empty so the user still gets a
  // file with headers (clearer than a 404).
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: rows[0] ? Object.keys(rows[0]) : undefined,
  });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `${safeName}_${suffix}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
