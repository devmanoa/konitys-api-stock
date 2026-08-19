import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet, getSheetData, parseExcelDate } from './parsing';

// Import orders
export async function importOrders(workbook: XLSX.WorkBook, result: ImportResult) {
  const sheetName = findSheet(workbook, 'COMMANDE');
  if (!sheetName) return;

  const data = getSheetData(workbook, sheetName);

  for (const row of data) {
    const productRef = row['Produit']?.toString().trim().toUpperCase();
    const supplierName = row['Fournisseur']?.toString().trim();
    const status = row['État commande']?.toString().trim() || row['Statut']?.toString().trim();
    const quantity = parseInt(row['Qté']) || parseInt(row['Quantité']) || 0;
    const receivedQty = parseInt(row['Qté reçue']) || null;
    const destination = row['Destination']?.toString().trim();
    const orderDate = parseExcelDate(row['Date commande'] || row['Date']);
    const expectedDate = parseExcelDate(row['Date prévue'] || row['Date livraison']);
    const receivedDate = parseExcelDate(row['Date réception']);
    const supplierRef = row['Ref fournisseur']?.toString() || row['Référence']?.toString() || null;
    const responsible = row['Responsable']?.toString() || null;
    const comment = row['Commentaire']?.toString() || null;

    if (!productRef || !quantity) continue;

    try {
      const product = await prisma.product.findUnique({ where: { reference: productRef } });
      if (!product) {
        result.orders.errors.push(`Commande "${productRef}": Produit non trouvé`);
        continue;
      }

      // Find or create supplier
      let supplier = supplierName
        ? await prisma.supplier.findFirst({ where: { name: supplierName } })
        : null;

      if (!supplier && supplierName) {
        supplier = await prisma.supplier.create({ data: { name: supplierName } });
        result.suppliers.created++;
      }

      if (!supplier) {
        result.orders.errors.push(`Commande "${productRef}": Fournisseur requis`);
        continue;
      }

      // Find destination site
      let destinationSite = null;
      if (destination) {
        const siteName = destination.split(':')[0].trim();
        destinationSite = await prisma.site.findFirst({ where: { name: siteName } });
      }

      // Map status
      let orderStatus: 'PENDING' | 'COMPLETED' | 'CANCELLED' = 'PENDING';
      if (status === 'Terminé' || status === 'Reçu' || status === 'COMPLETED') {
        orderStatus = 'COMPLETED';
      } else if (status === 'Annulé' || status === 'CANCELLED') {
        orderStatus = 'CANCELLED';
      }

      await prisma.$transaction(async (tx) => {
        // Generate orderNumber: CMD-YYYY-NNNN
        const year = new Date().getFullYear();
        const prefix = `CMD-${year}-`;
        const lastOrder = await tx.order.findFirst({
          where: { orderNumber: { startsWith: prefix } },
          orderBy: { orderNumber: 'desc' },
          select: { orderNumber: true },
        });
        let nextSeq = 1;
        if (lastOrder?.orderNumber) {
          const parts = lastOrder.orderNumber.split('-');
          const lastSeq = parseInt(parts[2], 10);
          if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
        }
        const orderNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

        await tx.order.create({
          data: {
            orderNumber,
            supplierId: supplier.id,
            status: orderStatus,
            orderDate: orderDate || new Date(),
            expectedDate,
            receivedDate: orderStatus === 'COMPLETED' ? (receivedDate || new Date()) : null,
            destinationSiteId: destinationSite?.id,
            responsible,
            supplierRef,
            comment,
            items: {
              create: [{
                productId: product.id,
                quantity,
                receivedQty: orderStatus === 'COMPLETED' ? (receivedQty || quantity) : null,
                receivedDate: orderStatus === 'COMPLETED' ? (receivedDate || new Date()) : null,
                condition: orderStatus === 'COMPLETED' ? 'NEW' : null,
              }],
            },
          },
        });
      });
      result.orders.created++;
    } catch (error: any) {
      result.orders.errors.push(`Commande "${productRef}": ${error.message}`);
    }
  }
}
