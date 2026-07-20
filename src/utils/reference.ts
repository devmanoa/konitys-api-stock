import prisma from '../config/database';

/**
 * Helpers de génération et normalisation des références produit
 * (voir docs "Règle de génération des références produit").
 *
 * Format : <CODE_CATEGORIE>-<MARQUE>-<MODELE>[-<VARIANTE>]
 * Ex     : IMPR-DNP-DS620, ADAPT-USBC-HDMI, CABLE-HDMI-2M
 *
 * Normalisation :
 *   - majuscules
 *   - accents strippés (NFD + drop combining marks)
 *   - espaces / underscores / dots → tirets
 *   - caractères hors [A-Z0-9-] supprimés
 *   - tirets consécutifs collapsés
 *   - tirets en début/fin retirés
 */

export function normalizeSegment(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks
    .toUpperCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Construit une référence à partir des segments structurés. Les segments
 * vides sont ignorés (aucun tiret vide dans la sortie).
 */
export function buildReference(parts: {
  code: string;
  brand?: string | null;
  model?: string | null;
  variant?: string | null;
}): string {
  const segs = [parts.code, parts.brand, parts.model, parts.variant]
    .map(normalizeSegment)
    .filter((s) => s.length > 0);
  return segs.join('-');
}

/**
 * Génère une référence unique en base. Si la référence naturelle
 * (`<code>-<brand>-<model>-<variant>`) est déjà prise, ajoute un suffixe
 * `-2`, `-3`, ... jusqu'à trouver un slot libre.
 *
 * Retourne la référence à écrire. Ne fait pas l'INSERT (le caller le
 * fait dans sa propre transaction).
 */
export async function generateUniqueReference(parts: {
  code: string;
  brand?: string | null;
  model?: string | null;
  variant?: string | null;
}): Promise<string> {
  const base = buildReference(parts);
  if (!base) {
    throw new Error(
      "Impossible de générer la référence : au moins un segment doit être non vide",
    );
  }

  // Cherche toutes les refs qui commencent par la base pour choisir le suffixe.
  // Bornée sur la collision exacte + la famille "base-<n>".
  const collision = await prisma.product.findFirst({
    where: { reference: base },
    select: { id: true },
  });
  if (!collision) return base;

  const candidates = await prisma.product.findMany({
    where: { reference: { startsWith: `${base}-` } },
    select: { reference: true },
  });
  const suffixes = new Set<number>();
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  for (const c of candidates) {
    const m = re.exec(c.reference);
    if (m) suffixes.add(parseInt(m[1], 10));
  }
  let n = 2;
  while (suffixes.has(n)) n += 1;
  return `${base}-${n}`;
}
