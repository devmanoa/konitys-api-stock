import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';

/**
 * Admin-side endpoints to manage public mobile share links.
 *
 * A share link impersonates a Keycloak user that has already logged into the
 * app at least once (so they exist in `users`). The link itself is the
 * credential: anyone who has the URL can POST entries AS that user.
 *
 * All endpoints in this controller are behind the standard requireAuth +
 * requireRole middleware — link management is admin-only.
 */

// POST /api/inventories/:id/share-links
// Body: { operatorUserId: string, expiresAt?: ISO string | null }
export const create = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const inventoryId = String(req.params.id);
    const { operatorUserId, expiresAt } = (req.body || {}) as {
      operatorUserId?: string;
      expiresAt?: string | null;
    };

    if (!operatorUserId) {
      throw new AppError('operatorUserId requis', 400);
    }

    const inv = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new AppError('Inventaire introuvable', 404);
    if (inv.status === 'CLOSED') {
      throw new AppError('Inventaire clôturé — impossible de générer un lien', 400);
    }

    const operator = await prisma.user.findUnique({ where: { id: operatorUserId } });
    if (!operator) {
      throw new AppError("Opérateur introuvable — il doit s'être connecté au moins une fois", 404);
    }

    const link = await prisma.inventoryShareLink.create({
      data: {
        inventoryId,
        operatorUserId: operator.id,
        operatorName: operator.fullName || operator.email || 'Opérateur',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdById: req.user?.id || null,
        createdByName: req.user?.fullName || req.user?.username || null,
      },
    });

    res.status(201).json({ success: true, data: link });
  } catch (error) {
    next(error);
  }
};

// GET /api/inventories/:id/share-links
export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inventoryId = String(req.params.id);
    const links = await prisma.inventoryShareLink.findMany({
      where: { inventoryId },
      include: {
        operatorUser: {
          select: { id: true, fullName: true, photoNom: true },
        },
        _count: { select: { entries: true, unknowns: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: links });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/share-links/:linkId
// Sets revokedAt — doesn't delete the row, so we keep the audit trail of
// entries that were created via this link.
export const revoke = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const linkId = String(req.params.linkId);
    const link = await prisma.inventoryShareLink.findUnique({ where: { id: linkId } });
    if (!link) throw new AppError('Lien introuvable', 404);
    if (link.revokedAt) {
      return res.json({ success: true, data: link });
    }
    const updated = await prisma.inventoryShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};
