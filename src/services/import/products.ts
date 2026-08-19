import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet, getSheetData, mapSupplyRisk } from './parsing';

// Import products
export async function importProducts(workbook: XLSX.WorkBook, result: ImportResult) {
  // Try PRODUITS sheet first, then SYNTHESE
  let sheetName = findSheet(workbook, 'PRODUITS');
  if (!sheetName) sheetName = findSheet(workbook, 'SYNTHESE');
  if (!sheetName) return;

  const data = getSheetData(workbook, sheetName);

  for (const row of data) {
    const reference = (row['Référence produit'] || row['Référence'] || row['Produit'])?.toString().trim().toUpperCase();
    if (!reference) continue;

    try {
      const productData = {
        reference,
        description: row['Description']?.toString() || row['Désignation']?.toString() || null,
        supplyRisk: mapSupplyRisk(row['Risque appro'] || row['Risque']),
        location: row['Emplacement']?.toString() || row['Location']?.toString() || null,
        comment: row['Commentaire']?.toString() || row['Notes']?.toString() || null,
      };

      const existing = await prisma.product.findUnique({ where: { reference } });
      if (existing) {
        await prisma.product.update({
          where: { reference },
          data: productData,
        });
        result.products.updated++;
      } else {
        await prisma.product.create({
          data: productData,
        });
        result.products.created++;
      }
    } catch (error: any) {
      result.products.errors.push(`Produit "${reference}": ${error.message}`);
    }
  }
}
