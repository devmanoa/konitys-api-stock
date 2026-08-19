import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { buildCountedMap, buildTheoreticalMap } from './compare';

// Construction du fichier xlsx d'export d'un inventaire.
// La forme des onglets reflete ce que l'UI affiche.

export interface InventoryExportFile {
  buffer: Buffer;
  filename: string;
}

// Construit le classeur pour l'onglet demande (entries | unknowns | compare).
// Le param filter reproduit les pastilles de filtre de l'UI
// ("Avec écart" / "Surplus" / "Manquants" / "Tout").
export async function buildInventoryExportFile(
  inv: { id: string; name: string; siteId: string | null },
  tabParam: string,
  filterParam: string,
): Promise<InventoryExportFile> {
  const id = inv.id;

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

    const countedMap = await buildCountedMap(id);
    const theoreticalMap = await buildTheoreticalMap(inv.siteId);

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

  return { buffer, filename: `${safeName}_${suffix}.xlsx` };
}
