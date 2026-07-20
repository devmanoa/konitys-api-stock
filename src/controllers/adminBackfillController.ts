import { Response } from 'express';
import { AuthenticatedRequest } from '../types/auth';
import prisma from '../config/database';
import { publishCrudEvent } from '../services/rabbitmq';

/**
 * One-shot admin endpoint to backfill Product.partType based on keyword
 * matching over the product reference + description. Only rewrites rows
 * where partType is currently NULL and where the heuristic yields ONE
 * unambiguous match. Ambiguous / no-match rows are left untouched and
 * listed in the response so the admin can tag them by hand.
 *
 * POST /api/admin/backfill-part-types
 *   body: { dryRun?: boolean }  // default: false — set true to preview
 *
 * Auth: requireRole('admin') at the route level.
 */

type PartType = 'EQUIPMENT' | 'PROTECTION' | 'HARDWARE';

// Ordered by specificity — more specific tokens first when they overlap.
// Matching is done on the concatenated `${reference} ${description}`
// lowercased, on word boundaries when possible (accents preserved).
const KEYWORDS: Record<PartType, string[]> = {
  HARDWARE: [
    'vis ', ' vis', 'visserie',
    'boulon', 'ecrou', 'écrou', 'rondelle',
    'clef', 'clé ', 'cle ',
    'entretoise', 'goujon', 'rivet',
    'chevron', 'chevill',
  ],
  PROTECTION: [
    'protection', 'protège', 'protege',
    'capot', 'coque', 'joint',
    'vitre', 'verre', 'plexi',
    'cache', 'couvercle',
    'antichoc', 'anti-choc',
    'film ', 'sticker',
  ],
  EQUIPMENT: [
    'écran', 'ecran', 'display', 'moniteur',
    'carte', 'pcb', 'contrôleur', 'controleur',
    'alim', 'alimentation', 'psu', 'chargeur',
    'lecteur', 'imprimante', 'scanner', 'douchette',
    'ordinateur', 'pc ', 'raspberry', 'arduino',
    'moteur', 'ventilateur', 'ventilo',
    'cable ', 'câble', 'nappe',
    'batterie', 'accu',
    'haut-parleur', 'haut parleur', 'speaker',
    'camera', 'caméra',
  ],
};

function detectPartType(reference: string, description: string | null): PartType | null {
  const hay = `${reference} ${description || ''}`.toLowerCase();
  const matches = new Set<PartType>();
  for (const [type, tokens] of Object.entries(KEYWORDS) as [PartType, string[]][]) {
    if (tokens.some((tok) => hay.includes(tok))) matches.add(type);
  }
  if (matches.size === 1) return Array.from(matches)[0];
  return null; // 0 match ou ambigu -> ne pas taguer
}

export async function backfillPartTypes(req: AuthenticatedRequest, res: Response) {
  const dryRun = req.body?.dryRun === true;

  const untagged = await prisma.product.findMany({
    where: { partType: null },
    select: { id: true, reference: true, description: true },
  });

  const decisions: {
    id: string;
    reference: string;
    description: string | null;
    partType: PartType | null;
  }[] = untagged.map((p) => ({
    ...p,
    partType: detectPartType(p.reference, p.description),
  }));

  const toApply = decisions.filter((d) => d.partType !== null);
  const skipped = decisions.filter((d) => d.partType === null);

  const perType: Record<PartType, number> = { EQUIPMENT: 0, PROTECTION: 0, HARDWARE: 0 };
  for (const d of toApply) perType[d.partType!] += 1;

  if (!dryRun) {
    // Batch updates in a single transaction. We publish events one-by-one
    // so downstream consumers (Factory, etc.) can refresh their caches.
    await prisma.$transaction(
      toApply.map((d) =>
        prisma.product.update({
          where: { id: d.id },
          data: { partType: d.partType! },
        }),
      ),
    );
    for (const d of toApply) {
      publishCrudEvent(
        'products',
        'updated',
        { id: d.id, partType: d.partType } as any,
        req.user,
      );
    }
  }

  res.json({
    success: true,
    data: {
      dryRun,
      totalUntagged: untagged.length,
      applied: dryRun ? 0 : toApply.length,
      wouldApply: dryRun ? toApply.length : undefined,
      perType,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 200).map((d) => ({
        id: d.id,
        reference: d.reference,
        description: d.description,
      })),
    },
  });
}

/**
 * POST /api/admin/bulk-set-part-type
 *   body: { productIds: string[], partType: PartType }
 *
 * Assigne le meme partType a un lot de produits (selection manuelle depuis
 * l'UI). Utilise apres le backfill auto pour rattraper les produits qui
 * n'ont pas matche l'heuristique.
 */
export async function bulkSetPartType(req: AuthenticatedRequest, res: Response) {
  const { productIds, partType } = req.body as {
    productIds?: unknown;
    partType?: unknown;
  };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ success: false, error: 'productIds requis' });
  }
  if (productIds.some((id) => typeof id !== 'string')) {
    return res.status(400).json({ success: false, error: 'productIds invalides' });
  }
  const validTypes: PartType[] = ['EQUIPMENT', 'PROTECTION', 'HARDWARE'];
  if (typeof partType !== 'string' || !validTypes.includes(partType as PartType)) {
    return res.status(400).json({ success: false, error: 'partType invalide' });
  }

  const ids = productIds as string[];
  const type = partType as PartType;

  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { partType: type },
  });

  // Publier un event par produit pour que les consumers (Factory) invalident
  // leurs caches. On ne recharge pas les rows depuis Prisma, on envoie juste
  // l'id + le nouveau partType — suffisant pour un cache refresh.
  for (const id of ids) {
    publishCrudEvent(
      'products',
      'updated',
      { id, partType: type } as any,
      req.user,
    );
  }

  res.json({
    success: true,
    data: { updated: result.count, partType: type },
  });
}
