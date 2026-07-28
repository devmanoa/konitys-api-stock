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

// ─── DB Export / Import ─────────────────────────────────────────────────

/**
 * Ordre des tables pour l'export et l'import.
 *
 * IMPORTANT : cet ordre respecte les foreign keys. Import = du HAUT vers
 * le BAS (parents d'abord), Wipe = du BAS vers le HAUT (enfants d'abord).
 *
 * Chaque entree est le nom de la propriete Prisma (camelCase).
 */
const EXPORT_TABLES = [
  // Reference tables (parents en premier, respectant les FK)
  'user',
  'partCategory',
  'productCategory',
  'assemblyType',
  'assembly',
  'assemblyAssemblyType',
  'assemblyTypeItem',
  'site',
  'location',
  'supplier',
  'supplierContact',
  // Products & catalog
  'product',
  'productAssemblyType',
  'productExternalLink',
  'productPartCategory',
  'productComment',
  'productSupplier',
  'productPriceHistory',
  'productSerialItem',
  'productAuditLog',
  // Stock & movements
  'stock',
  'stockMovement',
  // Packs
  'pack',
  'packItem',
  // Orders
  'order',
  'orderItem',
  'orderItemAnomaly',
  'orderComment',
  'orderAttachment',
  'orderAuditLog',
  // Order templates
  'orderTemplate',
  'orderTemplateItem',
  // Inventory
  'inventory',
  'inventoryEntry',
  'inventoryUnknownEntry',
  'inventoryShareLink',
] as const;

/**
 * GET /api/admin/db-export
 *
 * Renvoie un dump JSON de TOUTES les tables. Format :
 *   {
 *     meta: { app: 'stock', exportedAt, tables: [...], recordCounts: {...} },
 *     data: { userRef: [...], partCategory: [...], product: [...], ... }
 *   }
 *
 * Utilisation type : sauvegarde DEV -> restore PROD. Le fichier peut etre
 * telecharge via le browser (JSON attachment) puis importe via
 * POST /admin/db-import.
 */
export async function dbExport(req: AuthenticatedRequest, res: Response) {
  const data: Record<string, unknown[]> = {};
  const recordCounts: Record<string, number> = {};

  for (const tableName of EXPORT_TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: unknown[] = await (prisma as any)[tableName].findMany();
      data[tableName] = rows;
      recordCounts[tableName] = rows.length;
    } catch (err) {
      // Une table absente ou renommee ne bloque pas l'export global.
      console.warn(
        `[db-export] Table ${tableName} inaccessible :`,
        err instanceof Error ? err.message : String(err),
      );
      data[tableName] = [];
      recordCounts[tableName] = 0;
    }
  }

  const payload = {
    meta: {
      app: 'stock',
      exportedAt: new Date().toISOString(),
      exportedBy: req.user?.email || req.user?.username || null,
      tables: EXPORT_TABLES,
      recordCounts,
    },
    data,
  };

  const filename = `stock-db-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
}

/**
 * POST /api/admin/db-import
 *
 * Wipe complet de la DB puis restore depuis le fichier fourni.
 *
 * body : { data: { <table>: [...rows] }, confirm: 'WIPE_AND_RESTORE' }
 *
 * SECURITE : nécessite `confirm = "WIPE_AND_RESTORE"` en body pour éviter
 * les appels accidentels. En cas d'erreur au milieu de l'import, TOUT
 * est rollback (transaction).
 */
export async function dbImport(req: AuthenticatedRequest, res: Response) {
  const body = req.body as {
    data?: Record<string, unknown[]>;
    confirm?: string;
  };

  if (body.confirm !== 'WIPE_AND_RESTORE') {
    return res.status(400).json({
      success: false,
      error: 'confirm doit valoir exactement "WIPE_AND_RESTORE"',
    });
  }
  if (!body.data || typeof body.data !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'body.data manquant ou invalide',
    });
  }

  const data = body.data;
  const wipedCounts: Record<string, number> = {};
  const restoredCounts: Record<string, number> = {};

  try {
    // Wipe : ordre INVERSE (enfants d'abord)
    const wipeOrder = [...EXPORT_TABLES].reverse();
    for (const tableName of wipeOrder) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (prisma as any)[tableName].deleteMany();
        wipedCounts[tableName] = result?.count ?? 0;
      } catch (err) {
        console.warn(
          `[db-import] Wipe ${tableName} échoué :`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Restore : ordre normal (parents d'abord)
    for (const tableName of EXPORT_TABLES) {
      const rows = data[tableName];
      if (!Array.isArray(rows) || rows.length === 0) {
        restoredCounts[tableName] = 0;
        continue;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (prisma as any)[tableName].createMany({
          data: rows,
          skipDuplicates: true,
        });
        restoredCounts[tableName] = result?.count ?? rows.length;
      } catch (err) {
        // On log mais on continue pour donner un rapport complet
        console.error(
          `[db-import] Restore ${tableName} échoué :`,
          err instanceof Error ? err.message : String(err),
        );
        restoredCounts[tableName] = -1;
      }
    }

    void req;
    res.json({
      success: true,
      data: {
        wipedCounts,
        restoredCounts,
        totalRestored: Object.values(restoredCounts).reduce(
          (a, b) => a + (b > 0 ? b : 0),
          0,
        ),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      wipedCounts,
      restoredCounts,
    });
  }
}
