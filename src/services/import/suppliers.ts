import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet, getSheetData } from './parsing';

// Import suppliers
export async function importSuppliers(workbook: XLSX.WorkBook, result: ImportResult) {
  const sheetName = findSheet(workbook, 'FOURNISSEUR');
  if (!sheetName) return;

  const data = getSheetData(workbook, sheetName);
  const supplierNames = new Set<string>();

  data.forEach(row => {
    const name = row['Fournisseur']?.toString().trim();
    if (name) supplierNames.add(name);
  });

  for (const name of supplierNames) {
    try {
      const existing = await prisma.supplier.findFirst({ where: { name } });
      if (existing) {
        result.suppliers.updated++;
      } else {
        await prisma.supplier.create({
          data: { name },
        });
        result.suppliers.created++;
      }
    } catch (error: any) {
      result.suppliers.errors.push(`Fournisseur "${name}": ${error.message}`);
    }
  }
}

// Import product-supplier relations
export async function importProductSuppliers(workbook: XLSX.WorkBook, result: ImportResult) {
  const sheetName = findSheet(workbook, 'FOURNISSEUR');
  if (!sheetName) return;

  const data = getSheetData(workbook, sheetName);

  for (const row of data) {
    const productRef = row['Produit']?.toString().trim().toUpperCase();
    const supplierName = row['Fournisseur']?.toString().trim();

    if (!productRef || !supplierName) continue;

    try {
      const product = await prisma.product.findUnique({ where: { reference: productRef } });
      const supplier = await prisma.supplier.findFirst({ where: { name: supplierName } });

      if (!product || !supplier) {
        result.productSuppliers.errors.push(`Relation "${productRef}" - "${supplierName}": Produit ou fournisseur non trouvé`);
        continue;
      }

      const isPrimary = row['Principal ?'] === true || row['Principal ?'] === 'TRUE' || row['Principal ?'] === 'Oui';
      const unitPrice = parseFloat(row['PU HT'] || row['Prix']) || null;
      const leadTime = row['Délai']?.toString() || null;
      const shippingCost = parseFloat(row['Frais livraison'] || row['Frais']) || null;
      const supplierRef = row['Ref fournisseur']?.toString() || row['Référence fournisseur']?.toString() || null;
      const productUrl = row['URL']?.toString() || row['Lien']?.toString() || null;

      // Check existing relation
      const existing = await prisma.productSupplier.findUnique({
        where: {
          productId_supplierId: {
            productId: product.id,
            supplierId: supplier.id,
          },
        },
      });

      if (existing) {
        const priceChanged =
          unitPrice != null && Number(existing.unitPrice ?? 0) !== Number(unitPrice);
        await prisma.productSupplier.update({
          where: { id: existing.id },
          data: {
            isPrimary,
            unitPrice,
            leadTime,
            shippingCost,
            supplierRef,
            productUrl,
            ...(priceChanged && { priceUpdatedAt: new Date() }),
            ...(existing.priceUpdatedAt == null && unitPrice != null && {
              priceUpdatedAt: new Date(),
            }),
          },
        });
        result.productSuppliers.updated++;
      } else {
        await prisma.productSupplier.create({
          data: {
            productId: product.id,
            supplierId: supplier.id,
            isPrimary,
            unitPrice,
            priceUpdatedAt: unitPrice != null ? new Date() : null,
            leadTime,
            shippingCost,
            supplierRef,
            productUrl,
          },
        });
        result.productSuppliers.created++;
      }
    } catch (error: any) {
      result.productSuppliers.errors.push(`Relation "${productRef}" - "${supplierName}": ${error.message}`);
    }
  }
}
