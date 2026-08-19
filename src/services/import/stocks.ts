import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet } from './parsing';

// Import initial stock
export async function importStockInitial(workbook: XLSX.WorkBook, result: ImportResult) {
  // Try STOCK INITIAL first, then SYNTHESE
  let sheetName = findSheet(workbook, 'STOCK INITIAL');
  if (!sheetName) sheetName = findSheet(workbook, 'SYNTHESE');
  if (!sheetName) return;

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  if (data.length < 2) return;

  const headers = data[0] as string[];
  const rows = data.slice(1);

  // Find stock columns (format: "SiteName : neuf" or "SiteName : occasion")
  const stockColumns: { index: number; siteName: string; condition: 'NEW' | 'USED' }[] = [];

  headers.forEach((header, index) => {
    if (!header) return;
    const headerStr = header.toString();

    if (headerStr.includes(': neuf') || headerStr.includes(': occasion')) {
      let siteName = headerStr.split(':')[0].trim();
      // Remove "SI " prefix if present
      if (siteName.startsWith('SI ')) {
        siteName = siteName.substring(3);
      }
      // Skip sortie and total columns
      if (siteName.toLowerCase().includes('sortie') || siteName.toLowerCase().includes('total')) {
        return;
      }

      stockColumns.push({
        index,
        siteName,
        condition: headerStr.includes(': neuf') ? 'NEW' : 'USED',
      });
    }
  });

  // Find product reference column
  const refColIndex = headers.findIndex(h =>
    h && (h.toString().includes('Référence') || h.toString() === 'Produit')
  );

  if (refColIndex === -1) return;

  for (const row of rows) {
    const productRef = row[refColIndex]?.toString().trim().toUpperCase();
    if (!productRef) continue;

    const product = await prisma.product.findUnique({ where: { reference: productRef } });
    if (!product) continue;

    for (const col of stockColumns) {
      const quantity = parseInt(row[col.index]) || 0;
      if (quantity === 0) continue;

      try {
        const site = await prisma.site.findFirst({ where: { name: col.siteName } });
        if (!site) {
          // Create site if it doesn't exist
          const newSite = await prisma.site.create({
            data: {
              name: col.siteName,
              type: 'STORAGE',
              isActive: true,
            },
          });
          result.sites.created++;

          await upsertStock(product.id, newSite.id, col.condition, quantity, result);
        } else {
          await upsertStock(product.id, site.id, col.condition, quantity, result);
        }
      } catch (error: any) {
        result.stocks.errors.push(`Stock "${productRef}" @ "${col.siteName}": ${error.message}`);
      }
    }
  }
}

async function upsertStock(
  productId: string,
  siteId: string,
  condition: 'NEW' | 'USED',
  quantity: number,
  result: ImportResult
) {
  const existing = await prisma.stock.findUnique({
    where: {
      productId_siteId: { productId, siteId },
    },
  });

  const updateData = condition === 'NEW'
    ? { quantityNew: quantity }
    : { quantityUsed: quantity };

  if (existing) {
    await prisma.stock.update({
      where: { id: existing.id },
      data: updateData,
    });
    result.stocks.updated++;
  } else {
    await prisma.stock.create({
      data: {
        productId,
        siteId,
        quantityNew: condition === 'NEW' ? quantity : 0,
        quantityUsed: condition === 'USED' ? quantity : 0,
      },
    });
    result.stocks.created++;
  }
}
