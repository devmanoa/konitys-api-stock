import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { ResolvedShareLink } from '../middleware/inventoryShareLink';

/**
 * Public endpoints used by the mobile share-link UI.
 *
 * The "user" is the link itself, which carries the identity of a pre-selected
 * Keycloak user. We deliberately expose ONLY what's needed to do saisie:
 *   - inventory name & site
 *   - locations tree
 *   - search products
 *   - create entries / unknown entries
 *   - list and delete OWN recent entries
 *
 * Never exposed via /public:
 *   - theoretical stock
 *   - other inventories
 *   - other operators' entries
 *   - any kind of admin data (close/reopen/compare/apply-corrections)
 */

const ENTRY_SOURCES = ['SCAN', 'SEARCH', 'CATEGORY', 'UNKNOWN'] as const;
const ITEM_STATES = ['OK', 'TO_CHECK', 'DAMAGED', 'OUT_OF_SERVICE'] as const;

function getLink(req: Request): ResolvedShareLink {
  return (req as any).shareLink as ResolvedShareLink;
}

// GET /public/inventory/:linkId
// Returns the minimum needed by the mobile app to render the welcome screen.
export const resolve = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
    const inv = await prisma.inventory.findUnique({
      where: { id: link.inventoryId },
      include: {
        site: { select: { id: true, name: true } },
      },
    });
    if (!inv) throw new AppError('Inventaire introuvable', 404);

    res.json({
      success: true,
      data: {
        inventoryId: inv.id,
        inventoryName: inv.name,
        inventoryStatus: inv.status,
        site: inv.site,
        operatorName: link.operatorName,
        expiresAt: link.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /public/inventory/:linkId/locations
export const listLocations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
    const inv = await prisma.inventory.findUnique({
      where: { id: link.inventoryId },
      select: { siteId: true },
    });
    if (!inv) throw new AppError('Inventaire introuvable', 404);

    const where: any = {};
    if (inv.siteId) where.siteId = inv.siteId;

    const locations = await prisma.location.findMany({
      where,
      select: { id: true, name: true, parentId: true, siteId: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: locations });
  } catch (err) {
    next(err);
  }
};

// GET /public/inventory/:linkId/products?q=...
export const searchProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        reference: true,
        description: true,
        imageUrl: true,
        hasSerialNumber: true,
      },
      take: 30,
      orderBy: { reference: 'asc' },
    });
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
};

// GET /public/inventory/:linkId/products/:productId
export const getProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.productId);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        description: true,
        imageUrl: true,
        hasSerialNumber: true,
      },
    });
    if (!product) throw new AppError('Produit introuvable', 404);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

// GET /public/inventory/:linkId/check-serial?productId=...&serial=...
export const checkSerial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
    const productId = String(req.query.productId || '');
    const serial = String(req.query.serial || '').trim();
    if (!productId || !serial) {
      return res.json({ success: true, data: { duplicate: false } });
    }
    const existing = await prisma.inventoryEntry.findFirst({
      where: { inventoryId: link.inventoryId, productId, serialNumber: serial },
      select: { id: true, createdAt: true, operatorName: true },
    });
    res.json({ success: true, data: { duplicate: !!existing, existing } });
  } catch (err) {
    next(err);
  }
};

// POST /public/inventory/:linkId/entries
// Body: { productId, locationId?, quantity?, serialNumber?, state?, comment?, photoUrl?, source? }
export const createEntry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
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
        inventoryId: link.inventoryId,
        productId,
        locationId: locationId || null,
        quantity: product.hasSerialNumber ? 1 : qty,
        serialNumber: trimmedSerial,
        state: finalState,
        comment: comment || null,
        photoUrl: photoUrl || null,
        source: finalSource,
        operatorId: link.operatorUserId,
        operatorName: link.operatorName,
        shareLinkId: link.id,
      },
      include: {
        product: {
          select: { id: true, reference: true, description: true, imageUrl: true, hasSerialNumber: true },
        },
        location: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
};

// POST /public/inventory/:linkId/unknowns
// Body: { description, category?, quantity?, comment?, photoUrl?, locationId? }
export const createUnknown = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
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
        inventoryId: link.inventoryId,
        locationId: locationId || null,
        description: description.trim(),
        category: category || null,
        quantity: Math.max(1, Number(quantity ?? 1) || 1),
        comment: comment || null,
        photoUrl: photoUrl || null,
        operatorId: link.operatorUserId,
        operatorName: link.operatorName,
        shareLinkId: link.id,
      },
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
};

// GET /public/inventory/:linkId/my-recent
// Latest entries + unknowns recorded via this specific link. Used by the
// mobile UI to render "Mes dernières saisies" with a delete button.
export const myRecent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);

    const [entries, unknowns] = await Promise.all([
      prisma.inventoryEntry.findMany({
        where: { shareLinkId: link.id },
        include: {
          product: {
            select: { id: true, reference: true, description: true, imageUrl: true, hasSerialNumber: true },
          },
          location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.inventoryUnknownEntry.findMany({
        where: { shareLinkId: link.id },
        include: {
          location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    res.json({ success: true, data: { entries, unknowns } });
  } catch (err) {
    next(err);
  }
};

// DELETE /public/inventory/:linkId/entries/:entryId
// Refuses to remove an entry that wasn't created via this same link.
export const deleteEntry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
    const entryId = String(req.params.entryId);
    const entry = await prisma.inventoryEntry.findUnique({
      where: { id: entryId },
      select: { id: true, shareLinkId: true, inventoryId: true },
    });
    if (!entry || entry.inventoryId !== link.inventoryId || entry.shareLinkId !== link.id) {
      throw new AppError('Saisie introuvable', 404);
    }
    await prisma.inventoryEntry.delete({ where: { id: entryId } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /public/inventory/:linkId/unknowns/:unknownId
export const deleteUnknown = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = getLink(req);
    const unknownId = String(req.params.unknownId);
    const entry = await prisma.inventoryUnknownEntry.findUnique({
      where: { id: unknownId },
      select: { id: true, shareLinkId: true, inventoryId: true },
    });
    if (!entry || entry.inventoryId !== link.inventoryId || entry.shareLinkId !== link.id) {
      throw new AppError('Saisie introuvable', 404);
    }
    await prisma.inventoryUnknownEntry.delete({ where: { id: unknownId } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
