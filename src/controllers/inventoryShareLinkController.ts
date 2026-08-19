import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';
import { asyncHandler } from '../utils/asyncHandler';

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
export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
});

// GET /api/inventories/:id/share-links
//
// SECURITY: le champ `id` d'un share-link EST la credential publique — quiconque
// le possede peut POST/DELETE des entries en usurpant l'operateur cible via
// /api/public/inventory/<id>. Cette route reste ouverte a tout utilisateur
// authentifie (pour que la page detail d'inventaire puisse afficher le compteur
// "0 lien(s)" sans 403), MAIS elle ne doit jamais renvoyer `id` ni `linkUrl`
// aux clients non admin/manager. Les admins/managers passent par
// /api/share-links/mine ou re-fetchent la creation.
export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const inventoryId = String(req.params.id);
  const roles = req.user?.roles || [];
  const canSeeSecret = roles.includes('admin') || roles.includes('manager');

  const links = await prisma.inventoryShareLink.findMany({
    where: { inventoryId },
    select: {
      // id ommited by default — only exposed to admin/manager below
      ...(canSeeSecret ? { id: true } : {}),
      inventoryId: true,
      operatorUserId: true,
      operatorName: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
      createdByName: true,
      operatorUser: {
        select: { id: true, fullName: true, photoNom: true },
      },
      _count: { select: { entries: true, unknowns: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: links });
});

// DELETE /api/share-links/:linkId
// Sets revokedAt — doesn't delete the row, so we keep the audit trail of
// entries that were created via this link.
export const revoke = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
});
