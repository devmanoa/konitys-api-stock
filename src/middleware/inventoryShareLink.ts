import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

/**
 * Resolve the share link from the URL and attach it to the request.
 *
 * The link is the credential. We refuse:
 *   - missing / unknown linkId           → 404
 *   - revoked link                       → 410 Gone
 *   - expired link                       → 410 Gone
 *   - link whose inventory is CLOSED     → 423 Locked (saisie impossible)
 *
 * On success we set `(req as any).shareLink` with the link row + a stamped
 * `now` so all downstream handlers share the same reference.
 *
 * No rate limiting here: that lives in the route layer (see rateLimit
 * middleware in routes/publicInventory.ts).
 */
export interface ResolvedShareLink {
  id: string;
  inventoryId: string;
  operatorUserId: string;
  operatorName: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function resolveShareLink(req: Request, res: Response, next: NextFunction) {
  try {
    const linkId = String(req.params.linkId || '').trim();
    if (!linkId) {
      return res.status(404).json({ success: false, error: 'Lien introuvable' });
    }

    const link = await prisma.inventoryShareLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      return res.status(404).json({ success: false, error: 'Lien introuvable' });
    }
    if (link.revokedAt) {
      return res.status(410).json({ success: false, error: 'Lien révoqué' });
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ success: false, error: 'Lien expiré' });
    }

    (req as any).shareLink = link as ResolvedShareLink;

    // Best-effort lastUsedAt bump; don't block the request on it.
    prisma.inventoryShareLink
      .update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Reject any write when the inventory has been closed in the meantime.
 * Symmetric with assertEditable() in the authenticated controller.
 */
export async function assertInventoryEditable(req: Request, res: Response, next: NextFunction) {
  try {
    const link = (req as any).shareLink as ResolvedShareLink | undefined;
    if (!link) {
      return res.status(404).json({ success: false, error: 'Lien introuvable' });
    }
    const inv = await prisma.inventory.findUnique({
      where: { id: link.inventoryId },
      select: { status: true },
    });
    if (!inv) {
      return res.status(404).json({ success: false, error: 'Inventaire introuvable' });
    }
    if (inv.status === 'CLOSED') {
      return res.status(423).json({
        success: false,
        error: 'Inventaire clôturé : aucune saisie possible',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
