import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';

/**
 * Inventory V1.
 *
 * Operator-facing endpoints to record what's physically present in a zone,
 * without ever leaking the theoretical stock. Reconciliation happens in a
 * separate screen / pipeline that's NOT part of V1.
 */

const ENTRY_SOURCES = ['SCAN', 'SEARCH', 'CATEGORY', 'UNKNOWN'] as const;
const ITEM_STATES = ['OK', 'TO_CHECK', 'DAMAGED', 'OUT_OF_SERVICE'] as const;

// GET /inventories
export const list = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const inventories = await prisma.inventory.findMany({
      include: {
        site: true,
        _count: { select: { entries: true, unknowns: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json({ success: true, data: inventories });
  } catch (error) {
    next(error);
  }
};

// GET /inventories/:id
export const get = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inventory = await prisma.inventory.findUnique({
      where: { id: String(req.params.id) },
      include: {
        site: true,
        _count: { select: { entries: true, unknowns: true } },
      },
    });
    if (!inventory) throw new AppError('Inventaire introuvable', 404);
    res.json({ success: true, data: inventory });
  } catch (error) {
    next(error);
  }
};

// POST /inventories
export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, siteId } = (req.body || {}) as { name?: string; siteId?: string };
    if (!name?.trim()) throw new AppError('Nom de l\'inventaire requis', 400);
    const inventory = await prisma.inventory.create({
      data: {
        name: name.trim(),
        siteId: siteId || null,
      },
    });
    res.status(201).json({ success: true, data: inventory });
  } catch (error) {
    next(error);
  }
};

// GET /inventories/:id/entries?locationId=...&limit=...
//
// Returns the latest entries first. When `locationId` is given we filter on
// it; otherwise we return entries across the whole inventory.
export const listEntries = async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

// POST /inventories/:id/entries
// Body: { productId, locationId?, quantity?, serialNumber?, state?, comment?, photoUrl?, source? }
//
// Duplicate detection is reported but doesn't block — the client decides
// whether to confirm or replace.
export const createEntry = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
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
  } catch (error) {
    next(error);
  }
};

// PATCH /inventories/:id/entries/:entryId — used to "replace quantity" for a
// quantitative duplicate, or to fix a typo.
export const updateEntry = async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

// DELETE /inventories/:id/entries/:entryId
export const deleteEntry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.inventoryEntry.delete({ where: { id: String(req.params.entryId) } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// GET /inventories/:id/unknowns?locationId=...
export const listUnknowns = async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

// DELETE /inventories/:id/unknowns/:unknownId
export const deleteUnknown = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const unknownId = String(req.params.unknownId);
    await prisma.inventoryUnknownEntry.delete({ where: { id: unknownId } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// POST /inventories/:id/unknowns
// Body: { description, category?, quantity?, comment?, photoUrl?, locationId? }
export const createUnknown = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
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
  } catch (error) {
    next(error);
  }
};

// GET /inventories/:id/zone-summary?locationId=...
//
// Lightweight aggregate for the "Terminer la zone" screen. NEVER includes
// theoretical stock or gaps.
export const zoneSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

// GET /inventories/:id/check-serial?productId=...&serial=...
// Used by the client to flag a duplicate before posting the entry.
export const checkSerial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const productId = req.query.productId as string;
    const serial = (req.query.serial as string)?.trim();
    if (!productId || !serial) {
      return res.json({ success: true, data: { duplicate: false } });
    }
    const existing = await prisma.inventoryEntry.findFirst({
      where: { inventoryId: id!, productId, serialNumber: serial },
      select: { id: true, createdAt: true, operatorName: true },
    });
    res.json({ success: true, data: { duplicate: !!existing, existing } });
  } catch (error) {
    next(error);
  }
};
