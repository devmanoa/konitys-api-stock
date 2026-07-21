import { Response } from 'express';
import { AuthenticatedRequest } from '../types/auth';
import prisma from '../config/database';

/**
 * Endpoints one-shot d'administration Stock.
 *
 * Historique : ce fichier contenait aussi `backfillPartTypes` et
 * `bulkSetPartType`, qui operaient sur Product.partType. Depuis que
 * PartType est porte par la ProductCategory (et non plus par le Product),
 * ces endpoints n'ont plus de sens et ont ete supprimes.
 */

/**
 * POST /api/admin/seed-product-categories
 *
 * Cree les 13 categories principales listees dans "Regle de generation
 * des references produit" (Imprimante, PC, Ecran, ...). Idempotent :
 * skip si le code OU le nom existe deja (case-insensitive cote nom).
 */
const DEFAULT_PRODUCT_CATEGORIES: {
  name: string;
  codeReference: string;
  displayOrder: number;
}[] = [
  { name: 'Imprimante',    codeReference: 'IMPR',    displayOrder: 10 },
  { name: 'PC',            codeReference: 'PC',      displayOrder: 20 },
  { name: 'Écran',         codeReference: 'ECRAN',   displayOrder: 30 },
  { name: 'Appareil photo',codeReference: 'PHOTO',   displayOrder: 40 },
  { name: 'Flash',         codeReference: 'FLASH',   displayOrder: 50 },
  { name: 'Routeur',       codeReference: 'ROUTEUR', displayOrder: 60 },
  { name: 'Câble',         codeReference: 'CABLE',   displayOrder: 70 },
  { name: 'Adaptateur',    codeReference: 'ADAPT',   displayOrder: 80 },
  { name: 'Consommable',   codeReference: 'CONSO',   displayOrder: 90 },
  { name: 'Borne',         codeReference: 'BORNE',   displayOrder: 100 },
  { name: 'Flight case',   codeReference: 'FLIGHT',  displayOrder: 110 },
  { name: 'Structure',     codeReference: 'STRUCT',  displayOrder: 120 },
  { name: 'Accessoire',    codeReference: 'ACC',     displayOrder: 130 },
];

export async function seedProductCategories(req: AuthenticatedRequest, res: Response) {
  const existing = await prisma.productCategory.findMany({
    select: { name: true, codeReference: true },
  });
  const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
  const existingCodes = new Set(existing.map((e) => e.codeReference.toUpperCase()));

  const created: { name: string; codeReference: string }[] = [];
  const skipped: { name: string; codeReference: string; reason: string }[] = [];

  for (const cat of DEFAULT_PRODUCT_CATEGORIES) {
    if (existingNames.has(cat.name.toLowerCase())) {
      skipped.push({ ...cat, reason: 'nom déjà utilisé' });
      continue;
    }
    if (existingCodes.has(cat.codeReference.toUpperCase())) {
      skipped.push({ ...cat, reason: 'code déjà utilisé' });
      continue;
    }
    await prisma.productCategory.create({
      data: {
        name: cat.name,
        codeReference: cat.codeReference,
        displayOrder: cat.displayOrder,
        isActive: true,
      },
    });
    created.push({ name: cat.name, codeReference: cat.codeReference });
  }

  void req; // eslint hint
  res.json({
    success: true,
    data: {
      totalDefault: DEFAULT_PRODUCT_CATEGORIES.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    },
  });
}
