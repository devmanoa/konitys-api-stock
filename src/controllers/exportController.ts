import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Envoie un workbook mono-feuille au client, en CSV (avec BOM UTF-8
 * pour Excel) ou en XLSX selon le format demande.
 * `filename` est le nom de base sans extension (ex: 'produits').
 */
const sendWorkbook = (res: Response, workbook: XLSX.WorkBook, filename: string, format: string) => {
  if (format === 'csv') {
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  } else {
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
    res.send(buffer);
  }
};

// Export products to Excel
export const exportProducts = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'xlsx';

  const products = await prisma.product.findMany({
    include: {
      assembly: true,
      assemblyTypes: { include: { assemblyType: true } },
      productSuppliers: {
        include: { supplier: true },
        where: { isPrimary: true },
        take: 1,
      },
      stocks: {
        include: { site: true },
      },
    },
    orderBy: { reference: 'asc' },
  });

  // Get all storage sites for column headers
  const sites = await prisma.site.findMany({
    where: { type: 'STORAGE', isActive: true },
    orderBy: { name: 'asc' },
  });

  // Build headers
  const baseHeaders = [
    'Référence produit',
    'Description',
    'Type de produit',
    'Type de borne',
    'Qté 1 borne',
    'Risque appro',
    'Emplacement',
    'Fournisseur principal',
    'PA unit.',
    'Délai appro',
    'Frais livraison',
  ];

  // Add stock columns for each site
  const stockHeaders: string[] = [];
  sites.forEach(site => {
    stockHeaders.push(`${site.name} : neuf`);
    stockHeaders.push(`${site.name} : occasion`);
  });
  stockHeaders.push('Stock total neuf', 'Stock total occasion', 'Stock total', 'Bornes possibles avec stock');

  const headers = [...baseHeaders, ...stockHeaders];

  // Build data rows — one row per (product, assemblyType). If a product
  // has no linked type, still emit one row with empty type/qty.
  const rows: any[][] = [];
  products.forEach(product => {
    const primarySupplier = product.productSuppliers[0];

    // Calculate total stocks (same total for all (product, type) rows of a product)
    let totalNew = 0;
    let totalUsed = 0;
    const stockBySite: Record<string, { new: number; used: number }> = {};

    product.stocks.forEach(stock => {
      totalNew += stock.quantityNew;
      totalUsed += stock.quantityUsed;
      stockBySite[stock.site.name] = {
        new: stock.quantityNew,
        used: stock.quantityUsed,
      };
    });

    const total = totalNew + totalUsed;

    const typeLinks = product.assemblyTypes.length > 0
      ? product.assemblyTypes
      : [{ assemblyType: null as any, qtyPerUnit: 0 }];

    typeLinks.forEach(link => {
      const qty = link.qtyPerUnit;
      const possibleUnits = qty > 0 ? Math.floor(total / qty) : 0;

      const baseData = [
        product.reference,
        product.description || '',
        product.assembly?.name || '',
        link.assemblyType?.name || '',
        qty || '',
        mapRiskToFrench(product.supplyRisk),
        product.location || '',
        primarySupplier?.supplier?.name || '',
        primarySupplier?.unitPrice ? Number(primarySupplier.unitPrice) : '',
        primarySupplier?.leadTime || '',
        primarySupplier?.shippingCost ? Number(primarySupplier.shippingCost) : '',
      ];

      // Add stock data for each site
      const stockData: (number | string)[] = [];
      sites.forEach(site => {
        const siteStock = stockBySite[site.name] || { new: 0, used: 0 };
        stockData.push(siteStock.new || '');
        stockData.push(siteStock.used || '');
      });
      stockData.push(totalNew || '', totalUsed || '', total || '', possibleUnits || '');

      rows.push([...baseData, ...stockData]);
    });
  });

  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set column widths
  worksheet['!cols'] = headers.map((_, i) => ({
    wch: i < baseHeaders.length ? 20 : 12,
  }));

  XLSX.utils.book_append_sheet(workbook, worksheet, 'SYNTHESE');

  // Send file
  sendWorkbook(res, workbook, 'produits', format);
});

// Export stock matrix to Excel
export const exportStockMatrix = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'xlsx';

  const stocks = await prisma.stock.findMany({
    include: {
      product: true,
      site: true,
    },
    orderBy: [
      { product: { reference: 'asc' } },
      { site: { name: 'asc' } },
    ],
  });

  const sites = await prisma.site.findMany({
    where: { type: 'STORAGE', isActive: true },
    orderBy: { name: 'asc' },
  });

  // Build matrix
  const headers = ['Référence produit'];
  sites.forEach(site => {
    headers.push(`${site.name} : neuf`);
    headers.push(`${site.name} : occasion`);
    headers.push(`Total ${site.name}`);
  });
  headers.push('Stock total neuf', 'Stock total occasion', 'Stock total');

  // Group stocks by product
  const productStocks = new Map<string, { reference: string; stocks: Map<string, { new: number; used: number }> }>();

  stocks.forEach(stock => {
    if (!productStocks.has(stock.productId)) {
      productStocks.set(stock.productId, {
        reference: stock.product.reference,
        stocks: new Map(),
      });
    }
    productStocks.get(stock.productId)!.stocks.set(stock.site.name, {
      new: stock.quantityNew,
      used: stock.quantityUsed,
    });
  });

  const rows: (string | number)[][] = [];
  productStocks.forEach(product => {
    const row: (string | number)[] = [product.reference];
    let totalNew = 0;
    let totalUsed = 0;

    sites.forEach(site => {
      const siteStock = product.stocks.get(site.name) || { new: 0, used: 0 };
      row.push(siteStock.new || '');
      row.push(siteStock.used || '');
      row.push(siteStock.new + siteStock.used || '');
      totalNew += siteStock.new;
      totalUsed += siteStock.used;
    });

    row.push(totalNew || '', totalUsed || '', totalNew + totalUsed || '');
    rows.push(row);
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Matrice Stock');

  sendWorkbook(res, workbook, 'matrice_stock', format);
});

// Export movements to Excel
export const exportMovements = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'xlsx';
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

  const where: any = {};
  if (startDate || endDate) {
    where.movementDate = {};
    if (startDate) where.movementDate.gte = startDate;
    if (endDate) where.movementDate.lte = endDate;
  }

  const movements = await prisma.stockMovement.findMany({
    where,
    include: {
      product: true,
      sourceSite: true,
      targetSite: true,
    },
    orderBy: { movementDate: 'desc' },
  });

  const headers = [
    'Date',
    'Produit',
    'Type',
    'Source',
    'Destination',
    'Quantité',
    'État',
    'Opérateur',
    'Commentaire',
  ];

  const rows = movements.map(mvt => [
    mvt.movementDate.toISOString().split('T')[0],
    mvt.product.reference,
    mapMovementType(mvt.type),
    mvt.sourceSite ? `${mvt.sourceSite.name} : ${mvt.condition === 'NEW' ? 'neuf' : 'occasion'}` : '',
    mvt.targetSite ? `${mvt.targetSite.name} : ${mvt.condition === 'NEW' ? 'neuf' : 'occasion'}` : '',
    mvt.quantity,
    mvt.condition === 'NEW' ? 'Neuf' : 'Occasion',
    mvt.operator || '',
    mvt.comment || '',
  ]);

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Mouvements');

  sendWorkbook(res, workbook, 'mouvements', format);
});

// Export orders to Excel
export const exportOrders = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'xlsx';
  const status = req.query.status as string | undefined;

  const where: any = {};
  if (status) where.status = status;

  const orders = await prisma.order.findMany({
    where,
    include: {
      supplier: true,
      destinationSite: true,
      items: { include: { product: true } },
    },
    orderBy: { orderDate: 'desc' },
  });

  const headers = [
    'Date commande',
    'Titre commande',
    'Produit',
    'Fournisseur',
    'Qté',
    'Prix unitaire',
    'État commande',
    'Destination',
    'Date prévue',
    'Date réception item',
    'Qté reçue',
    'Ref fournisseur',
    'Responsable',
    'Commentaire',
  ];

  const rows: any[][] = [];
  orders.forEach(order => {
    order.items.forEach(item => {
      rows.push([
        order.orderDate.toISOString().split('T')[0],
        order.title || '',
        item.product.reference,
        order.supplier.name,
        item.quantity,
        item.unitPrice ? Number(item.unitPrice) : '',
        mapOrderStatus(order.status),
        order.destinationSite?.name || '',
        order.expectedDate?.toISOString().split('T')[0] || '',
        item.receivedDate?.toISOString().split('T')[0] || '',
        item.receivedQty || '',
        order.supplierRef || '',
        order.responsible || '',
        order.comment || '',
      ]);
    });
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Commandes');

  sendWorkbook(res, workbook, 'commandes', format);
});

// Export full database to Excel (multiple sheets)
export const exportAll = asyncHandler(async (req: Request, res: Response) => {
  const workbook = XLSX.utils.book_new();

  // 1. SYNTHESE (Products with stocks)
  const products = await prisma.product.findMany({
    include: {
      assembly: true,
      assemblyTypes: { include: { assemblyType: true } },
      productSuppliers: {
        include: { supplier: true },
        where: { isPrimary: true },
        take: 1,
      },
      stocks: { include: { site: true } },
    },
    orderBy: { reference: 'asc' },
  });

  const sites = await prisma.site.findMany({
    where: { type: 'STORAGE', isActive: true },
    orderBy: { name: 'asc' },
  });

  const syntheseHeaders = [
    'Référence produit', 'Description', 'Type de produit', 'Type de borne', 'Qté 1 borne', 'Risque appro', 'Emplacement',
    'Fournisseur principal', 'PA unit.', 'Délai appro', 'Frais livraison',
  ];
  sites.forEach(site => {
    syntheseHeaders.push(`${site.name} : neuf`, `${site.name} : occasion`);
  });
  syntheseHeaders.push('Stock total neuf', 'Stock total occasion', 'Stock total', 'Bornes possibles');

  const syntheseRows: any[][] = [];
  products.forEach(product => {
    const ps = product.productSuppliers[0];
    const stockBySite: Record<string, { new: number; used: number }> = {};
    let totalNew = 0, totalUsed = 0;

    product.stocks.forEach((s: any) => {
      totalNew += s.quantityNew;
      totalUsed += s.quantityUsed;
      stockBySite[s.site.name] = { new: s.quantityNew, used: s.quantityUsed };
    });

    const typeLinks = product.assemblyTypes.length > 0
      ? product.assemblyTypes
      : [{ assemblyType: null as any, qtyPerUnit: 0 }];

    typeLinks.forEach(link => {
      const qty = link.qtyPerUnit;
      const row: any[] = [
        product.reference, product.description || '', product.assembly?.name || '',
        link.assemblyType?.name || '',
        qty || '', mapRiskToFrench(product.supplyRisk), product.location || '',
        ps?.supplier?.name || '', ps?.unitPrice ? Number(ps.unitPrice) : '',
        ps?.leadTime || '', ps?.shippingCost ? Number(ps.shippingCost) : '',
      ];

      sites.forEach(site => {
        const ss = stockBySite[site.name] || { new: 0, used: 0 };
        row.push(ss.new || '', ss.used || '');
      });

      const total = totalNew + totalUsed;
      row.push(totalNew || '', totalUsed || '', total || '');
      row.push(qty > 0 ? Math.floor(total / qty) || '' : '');

      syntheseRows.push(row);
    });
  });

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([syntheseHeaders, ...syntheseRows]), 'SYNTHESE');

  // 2. REF FOURNISSEURS
  const productSuppliers = await prisma.productSupplier.findMany({
    include: { product: true, supplier: true },
    orderBy: [{ product: { reference: 'asc' } }, { isPrimary: 'desc' }],
  });

  const suppliersHeaders = ['Produit', 'Fournisseur', 'Principal ?', 'PU HT', 'Délai', 'Frais livraison', 'Ref fournisseur', 'URL'];
  const suppliersRows = productSuppliers.map(ps => [
    ps.product.reference, ps.supplier.name, ps.isPrimary,
    ps.unitPrice ? Number(ps.unitPrice) : '', ps.leadTime || '',
    ps.shippingCost ? Number(ps.shippingCost) : '', ps.supplierRef || '', ps.productUrl || '',
  ]);

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([suppliersHeaders, ...suppliersRows]), 'REF FOURNISSEURS');

  // 3. MVT CLASSIK
  const movements = await prisma.stockMovement.findMany({
    include: { product: true, sourceSite: true, targetSite: true },
    orderBy: { movementDate: 'desc' },
  });

  const mvtHeaders = ['Produit', 'Mouvement', 'Source', 'Cible', 'Qté', 'Date', 'Opérateur', 'Commentaire'];
  const mvtRows = movements.map(m => [
    m.product.reference, mapMovementType(m.type),
    m.sourceSite ? `${m.sourceSite.name} : ${m.condition === 'NEW' ? 'neuf' : 'occasion'}` : '',
    m.targetSite ? `${m.targetSite.name} : ${m.condition === 'NEW' ? 'neuf' : 'occasion'}` : '',
    m.quantity, m.movementDate.toISOString().split('T')[0],
    m.operator || '', m.comment || '',
  ]);

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([mvtHeaders, ...mvtRows]), 'MVT CLASSIK');

  // 4. COMMANDES CLASSIK
  const orders = await prisma.order.findMany({
    include: { supplier: true, destinationSite: true, items: { include: { product: true } } },
    orderBy: { orderDate: 'desc' },
  });

  const orderHeaders = ['Titre', 'Produit', 'Fournisseur', 'Qté', 'Prix unitaire', 'État commande', 'Destination', 'Date commande', 'Date prévue', 'Qté reçue', 'Responsable', 'Commentaire'];
  const orderRows: any[][] = [];
  orders.forEach(o => {
    o.items.forEach(item => {
      orderRows.push([
        o.title || '', item.product.reference, o.supplier.name, item.quantity,
        item.unitPrice ? Number(item.unitPrice) : '',
        mapOrderStatus(o.status), o.destinationSite?.name || '',
        o.orderDate.toISOString().split('T')[0],
        o.expectedDate?.toISOString().split('T')[0] || '',
        item.receivedQty || '', o.responsible || '', o.comment || '',
      ]);
    });
  });

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([orderHeaders, ...orderRows]), 'COMMANDES CLASSIK');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=export_complet_${new Date().toISOString().split('T')[0]}.xlsx`);
  res.send(buffer);
});

// Helper functions
function mapRiskToFrench(risk: string | null): string {
  if (!risk) return '';
  const map: Record<string, string> = {
    HIGH: 'Élevé',
    MEDIUM: 'Moyen',
    LOW: 'Faible',
  };
  return map[risk] || risk;
}

function mapMovementType(type: string): string {
  const map: Record<string, string> = {
    IN: 'Entrée',
    OUT: 'Sortie',
    TRANSFER: 'Déplacement',
  };
  return map[type] || type;
}

function mapOrderStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'En cours',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  };
  return map[status] || status;
}
