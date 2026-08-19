import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet, getSheetData, parseExcelDate, parseSiteCondition } from './parsing';

// Import movements
export async function importMovements(workbook: XLSX.WorkBook, result: ImportResult) {
  const sheetName = findSheet(workbook, 'MVT');
  if (!sheetName) return;

  const data = getSheetData(workbook, sheetName);

  for (const row of data) {
    const productRef = row['Produit']?.toString().trim().toUpperCase();
    const movementType = row['Mouvement']?.toString().trim();
    const source = row['Source']?.toString().trim();
    const cible = row['Cible']?.toString().trim();
    const quantity = parseInt(row['Qté']) || 0;
    const date = parseExcelDate(row['Date']);
    const operator = row['Opérateur']?.toString() || row['Responsable']?.toString() || null;
    const comment = row['Commentaire']?.toString() || row['Notes']?.toString() || null;

    if (!productRef || !quantity) continue;

    try {
      const product = await prisma.product.findUnique({ where: { reference: productRef } });
      if (!product) {
        result.movements.errors.push(`Mouvement "${productRef}": Produit non trouvé`);
        continue;
      }

      // Parse source and target from "SiteName : condition" format
      const { siteId: sourceSiteId, condition: sourceCondition } = await parseSiteCondition(source);
      const { siteId: targetSiteId, condition: targetCondition } = await parseSiteCondition(cible);

      let type: 'IN' | 'OUT' | 'TRANSFER';
      if (movementType === 'Sortie' || (source && source.toLowerCase().includes('sortie'))) {
        type = 'OUT';
      } else if (movementType === 'Déplacement' || movementType === 'Transfert') {
        type = 'TRANSFER';
      } else {
        type = 'IN';
      }

      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          type,
          sourceSiteId,
          targetSiteId,
          quantity,
          condition: sourceCondition || targetCondition || 'NEW',
          movementDate: date || new Date(),
          operator,
          comment,
        },
      });
      result.movements.created++;
    } catch (error: any) {
      result.movements.errors.push(`Mouvement "${productRef}": ${error.message}`);
    }
  }
}
