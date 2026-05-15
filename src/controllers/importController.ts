import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

interface ImportResult {
  products: { created: number; updated: number; errors: string[] };
  suppliers: { created: number; updated: number; errors: string[] };
  productSuppliers: { created: number; updated: number; errors: string[] };
  sites: { created: number; errors: string[] };
  stocks: { created: number; updated: number; errors: string[] };
  movements: { created: number; errors: string[] };
  orders: { created: number; errors: string[] };
}

// Preview import data without saving
export const previewImport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError('Aucun fichier fourni', 400);
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;

    const preview: Record<string, { headers: string[]; rows: number; sample: any[] }> = {};

    sheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (data.length > 0) {
        const headers = data[0] as string[];
        const rows = data.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));

        preview[name] = {
          headers: headers.filter(h => h),
          rows: rows.length,
          sample: rows.slice(0, 5).map(row => {
            const obj: Record<string, any> = {};
            headers.forEach((h, i) => {
              if (h) obj[h] = row[i];
            });
            return obj;
          }),
        };
      }
    });

    res.json({
      success: true,
      data: {
        fileName: req.file.originalname,
        sheets: preview,
        availableSheets: sheetNames,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Detect if workbook uses the flat format (sheets = assembly types with product+supplier in same rows)
function isFlatFormat(workbook: XLSX.WorkBook): boolean {
  const sheetNames = workbook.SheetNames.map(s => s.toLowerCase());
  // Flat format: no standard sheets, but has sheets like CLASSIK, SPHERIK, etc.
  const hasStandardSheets = sheetNames.some(s =>
    s.includes('produits') || s.includes('fournisseur') || s.includes('synthese')
  );
  if (hasStandardSheets) return false;

  // Check if first sheet has "Référence produit" + "Fournisseur A" columns (flat format signature)
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return false;
  const headers = (XLSX.utils.sheet_to_json(firstSheet, { header: 1 })[0] as string[]) || [];
  const headerStr = headers.filter(Boolean).join('|').toLowerCase();
  return headerStr.includes('référence produit') && headerStr.includes('fournisseur');
}

// Full import from Excel file
export const importExcel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError('Aucun fichier fourni', 400);
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', bookFiles: true });

    const result: ImportResult = {
      products: { created: 0, updated: 0, errors: [] },
      suppliers: { created: 0, updated: 0, errors: [] },
      productSuppliers: { created: 0, updated: 0, errors: [] },
      sites: { created: 0, errors: [] },
      stocks: { created: 0, updated: 0, errors: [] },
      movements: { created: 0, errors: [] },
      orders: { created: 0, errors: [] },
    };

    if (isFlatFormat(workbook)) {
      // New flat format: each sheet = assembly type, rows = product + supplier combined
      await importFlatFormat(workbook, result);
    } else {
      // Standard format: separate sheets for products, suppliers, etc.
      await importSites(workbook, result);
      await importSuppliers(workbook, result);
      await importProducts(workbook, result);
      await importProductSuppliers(workbook, result);
      await importStockInitial(workbook, result);
      await importMovements(workbook, result);
      await importOrders(workbook, result);
    }

    res.json({
      success: true,
      data: result,
      message: 'Import terminé',
    });
  } catch (error) {
    next(error);
  }
};

// Helper to get sheet data as objects
function getSheetData(workbook: XLSX.WorkBook, sheetName: string): any[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet);
}

// Helper to find sheet by partial name
function findSheet(workbook: XLSX.WorkBook, partialName: string): string | undefined {
  return workbook.SheetNames.find(name =>
    name.toLowerCase().includes(partialName.toLowerCase())
  );
}

// Import sites from sheet headers or dedicated sheet
async function importSites(workbook: XLSX.WorkBook, result: ImportResult) {
  const sites = new Set<string>();

  // Try to find sites from SYNTHESE headers
  const syntheseSheet = workbook.Sheets[findSheet(workbook, 'SYNTHESE') || ''];
  if (syntheseSheet) {
    const headers = XLSX.utils.sheet_to_json(syntheseSheet, { header: 1 })[0] as string[];
    headers.forEach(header => {
      if (header && (header.includes(': neuf') || header.includes(': occasion'))) {
        const siteName = header.split(':')[0].trim();
        // Skip "SI " prefix (Stock Initial)
        if (!siteName.startsWith('SI ') && !siteName.toLowerCase().includes('sortie') && !siteName.toLowerCase().includes('total')) {
          sites.add(siteName);
        }
      }
    });
  }

  // Also check for exit sites from movements
  const mouvementSheet = findSheet(workbook, 'MVT');
  if (mouvementSheet) {
    const movements = getSheetData(workbook, mouvementSheet);
    movements.forEach(mvt => {
      const source = mvt['Source']?.toString().trim();
      const cible = mvt['Cible']?.toString().trim();

      if (source) {
        const siteName = source.split(':')[0].trim();
        if (siteName.toLowerCase().includes('sortie')) {
          sites.add(siteName);
        }
      }
      if (cible) {
        const siteName = cible.split(':')[0].trim();
        sites.add(siteName);
      }
    });
  }

  for (const siteName of sites) {
    try {
      const isExit = siteName.toLowerCase().includes('sortie');
      await prisma.site.upsert({
        where: { name: siteName },
        create: {
          name: siteName,
          type: isExit ? 'EXIT' : 'STORAGE',
          isActive: true,
        },
        update: {},
      });
      result.sites.created++;
    } catch (error: any) {
      result.sites.errors.push(`Site "${siteName}": ${error.message}`);
    }
  }
}

// Import suppliers
async function importSuppliers(workbook: XLSX.WorkBook, result: ImportResult) {
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

// Import products
async function importProducts(workbook: XLSX.WorkBook, result: ImportResult) {
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
        qtyPerUnit: parseInt(row['Qté 1 borne']) || parseInt(row['Qté']) || 1,
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

// Import product-supplier relations
async function importProductSuppliers(workbook: XLSX.WorkBook, result: ImportResult) {
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

// Import initial stock
async function importStockInitial(workbook: XLSX.WorkBook, result: ImportResult) {
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

// Import movements
async function importMovements(workbook: XLSX.WorkBook, result: ImportResult) {
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

// Import orders
async function importOrders(workbook: XLSX.WorkBook, result: ImportResult) {
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

/**
 * Extract image-to-row mappings from an xlsx workbook.
 * xlsx files are zips containing:
 *   - xl/drawings/drawingN.xml — anchors linking images to cell rows
 *   - xl/drawings/_rels/drawingN.xml.rels — mapping rId to image file
 *   - xl/media/imageN.ext — actual image buffers
 * Sheet N uses drawingN (1-indexed).
 */
function extractSheetImages(workbook: any, sheetIndex: number): Map<number, { buffer: Buffer; ext: string }> {
  const rowToImage = new Map<number, { buffer: Buffer; ext: string }>();
  const files = workbook.files;
  if (!files) return rowToImage;

  const drawingFile = `xl/drawings/drawing${sheetIndex + 1}.xml`;
  const relsFile = `xl/drawings/_rels/drawing${sheetIndex + 1}.xml.rels`;

  const drawingEntry = files[drawingFile];
  const relsEntry = files[relsFile];
  if (!drawingEntry || !relsEntry) return rowToImage;

  const relsContent = relsEntry.content instanceof Buffer
    ? relsEntry.content.toString('utf8')
    : String(relsEntry.content || '');
  const drawingContent = drawingEntry.content instanceof Buffer
    ? drawingEntry.content.toString('utf8')
    : String(drawingEntry.content || '');

  // Parse rels: rId -> image filename
  const rIdToImageFile: Record<string, string> = {};
  const relRegex = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = relRegex.exec(relsContent)) !== null) {
    if (m[2].includes('media/')) {
      rIdToImageFile[m[1]] = m[2].replace('../media/', '');
    }
  }

  // Parse drawing: row -> rId (oneCellAnchor or twoCellAnchor)
  const anchorRegex = /<xdr:(?:one|two)CellAnchor[\s\S]*?<\/xdr:(?:one|two)CellAnchor>/g;
  while ((m = anchorRegex.exec(drawingContent)) !== null) {
    const anchor = m[0];
    const rowMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const embedMatch = anchor.match(/r:embed="(rId\d+)"/);
    if (rowMatch && embedMatch) {
      const row = parseInt(rowMatch[1]);
      const imageFileName = rIdToImageFile[embedMatch[1]];
      if (imageFileName) {
        const imageEntry = files[`xl/media/${imageFileName}`];
        if (imageEntry?.content instanceof Buffer) {
          const ext = path.extname(imageFileName) || '.png';
          rowToImage.set(row, { buffer: imageEntry.content, ext });
        }
      }
    }
  }

  return rowToImage;
}

/**
 * Save an image buffer to the uploads/products directory.
 * Returns the URL path (e.g., /uploads/products/uuid.jpg).
 */
function saveProductImage(imageBuffer: Buffer, ext: string): string {
  const uploadsDir = path.join(process.cwd(), 'uploads', 'products');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), imageBuffer);
  return `/uploads/products/${filename}`;
}

// Map sheet names to existing assembly type names in the database
const sheetNameToAssemblyType: Record<string, string> = {
  'CLASSIK': 'Borne Classik',
  'SPHERIK': 'Borne Spherik',
};

// Import flat format: each sheet = assembly type, rows have product + supplier combined
async function importFlatFormat(workbook: any, result: ImportResult) {
  const skipSheets = ['modif pour recopie'];

  for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
    const sheetName = workbook.SheetNames[sheetIdx];
    if (skipSheets.includes(sheetName.toLowerCase())) continue;

    const data = getSheetData(workbook, sheetName);
    if (data.length === 0) continue;

    // Extract images for this sheet (row index -> image buffer)
    const sheetImages = extractSheetImages(workbook, sheetIdx);

    // Map sheet name to assembly type name (e.g., CLASSIK -> borne classik)
    const assemblyTypeName = sheetNameToAssemblyType[sheetName] || sheetName;

    // Upsert AssemblyType from mapped name
    let assemblyType;
    try {
      assemblyType = await prisma.assemblyType.upsert({
        where: { name: assemblyTypeName },
        create: { name: assemblyTypeName },
        update: {},
      });
    } catch (error: any) {
      result.products.errors.push(`Type "${sheetName}": ${error.message}`);
      continue;
    }

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      const reference = (row['Référence produit'] || row['Référence'])?.toString().trim();
      if (!reference) continue;

      // Row index in drawing is 1-based (row 0 = header, row 1 = first data row)
      const imageData = sheetImages.get(rowIdx + 1);

      // --- Product ---
      try {
        const existing = await prisma.product.findUnique({ where: { reference } });

        if (existing) {
          // Product already exists: only update imageUrl if we have a new image
          const updateData: any = {};
          if (imageData) {
            updateData.imageUrl = saveProductImage(imageData.buffer, imageData.ext);
          }
          // Always update assemblyTypeId
          updateData.assemblyTypeId = assemblyType.id;
          await prisma.product.update({ where: { reference }, data: updateData });
          result.products.updated++;
        } else {
          // New product: create with all fields
          const productData: any = {
            reference,
            description: row['Description']?.toString() || null,
            qtyPerUnit: parseInt(row['Quantité pour 1 borne']) || parseInt(row['Qté 1 borne']) || 1,
            supplyRisk: mapSupplyRisk(row['Risques appro'] || row['Risque appro']),
            location: (row['Emplacement de stockage'] || row['Emplacement'])?.toString() || null,
            assemblyTypeId: assemblyType.id,
          };
          if (imageData) {
            productData.imageUrl = saveProductImage(imageData.buffer, imageData.ext);
          }
          await prisma.product.create({ data: productData });
          result.products.created++;
        }
      } catch (error: any) {
        result.products.errors.push(`Produit "${reference}": ${error.message}`);
        continue;
      }

      const product = await prisma.product.findUnique({ where: { reference } });
      if (!product) continue;

      // --- Supplier A ---
      const supplierAName = (row['Fournisseur A'] || row['Fournisseur'])?.toString().trim();
      if (supplierAName) {
        try {
          const supplier = await prisma.supplier.upsert({
            where: { name: supplierAName },
            create: { name: supplierAName },
            update: {},
          });

          const supplierRef = (row['Référence du Fournisseur A'] || row['Ref fournisseur'])?.toString() || null;
          const productUrl = row['Lien achat']?.toString() || null;
          const unitPrice = parseFloat(row["Prix d'achat unitaire"] || row['Prix']) || null;
          const leadTime = (row["Délai d'approvisionnement"] || row['Délai'])?.toString() || null;
          const shippingCost = parseFloat(row['Frais de livraison'] || row['Frais']) || null;
          const priceUpdatedAt = parseExcelDate(row['Date MAJ tarifs']);

          const existingPS = await prisma.productSupplier.findUnique({
            where: { productId_supplierId: { productId: product.id, supplierId: supplier.id } },
          });

          const psData = {
            isPrimary: true,
            supplierRef,
            productUrl,
            unitPrice,
            leadTime,
            shippingCost,
            priceUpdatedAt,
          };

          if (existingPS) {
            await prisma.productSupplier.update({ where: { id: existingPS.id }, data: psData });
            result.productSuppliers.updated++;
          } else {
            await prisma.productSupplier.create({
              data: { productId: product.id, supplierId: supplier.id, ...psData },
            });
            result.productSuppliers.created++;
          }
        } catch (error: any) {
          result.suppliers.errors.push(`Fournisseur A "${supplierAName}" (${reference}): ${error.message}`);
        }
      }

      // --- Supplier B ---
      const supplierBName = (row['Fournisseur B'])?.toString().trim();
      if (supplierBName) {
        try {
          const supplier = await prisma.supplier.upsert({
            where: { name: supplierBName },
            create: { name: supplierBName },
            update: {},
          });

          const supplierRef = (row['Code Fournisseur B'])?.toString() || null;

          const existingPS = await prisma.productSupplier.findUnique({
            where: { productId_supplierId: { productId: product.id, supplierId: supplier.id } },
          });

          if (existingPS) {
            await prisma.productSupplier.update({
              where: { id: existingPS.id },
              data: { isPrimary: false, supplierRef },
            });
            result.productSuppliers.updated++;
          } else {
            await prisma.productSupplier.create({
              data: { productId: product.id, supplierId: supplier.id, isPrimary: false, supplierRef },
            });
            result.productSuppliers.created++;
          }
        } catch (error: any) {
          result.suppliers.errors.push(`Fournisseur B "${supplierBName}" (${reference}): ${error.message}`);
        }
      }
    }
  }
}

// Helper functions
function mapSupplyRisk(value: any): 'HIGH' | 'MEDIUM' | 'LOW' | null {
  if (!value) return null;
  const str = value.toString().toLowerCase();
  if (str.includes('élevé') || str.includes('haut') || str.includes('high') || str.includes('fort') || str === '3') {
    return 'HIGH';
  }
  if (str.includes('moyen') || str.includes('medium') || str === '2') {
    return 'MEDIUM';
  }
  if (str.includes('faible') || str.includes('bas') || str.includes('low') || str === '1') {
    return 'LOW';
  }
  return null;
}

function parseExcelDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date
    return new Date((value - 25569) * 86400 * 1000);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

async function parseSiteCondition(value: string | undefined): Promise<{ siteId: string | null; condition: 'NEW' | 'USED' | null }> {
  if (!value) return { siteId: null, condition: null };

  const parts = value.split(':');
  const siteName = parts[0].trim();
  const conditionStr = parts[1]?.trim().toLowerCase();

  const site = await prisma.site.findFirst({ where: { name: siteName } });
  const condition = conditionStr?.includes('occasion') ? 'USED' : conditionStr?.includes('neuf') ? 'NEW' : null;

  return { siteId: site?.id || null, condition };
}

// Export templates
export const getExportTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workbook = XLSX.utils.book_new();

    // Products template
    const productsData = [
      ['Référence produit', 'Description', 'Qté 1 borne', 'Risque appro', 'Emplacement', 'Commentaire'],
      ['PROD-001', 'Description du produit', 1, 'Moyen', 'A1', 'Notes...'],
    ];
    const productsSheet = XLSX.utils.aoa_to_sheet(productsData);
    XLSX.utils.book_append_sheet(workbook, productsSheet, 'PRODUITS');

    // Suppliers template
    const suppliersData = [
      ['Produit', 'Fournisseur', 'Principal ?', 'PU HT', 'Délai', 'Frais livraison', 'Ref fournisseur', 'URL'],
      ['PROD-001', 'Fournisseur A', true, 10.50, '2-3 jours', 5.00, 'FA-001', 'https://...'],
    ];
    const suppliersSheet = XLSX.utils.aoa_to_sheet(suppliersData);
    XLSX.utils.book_append_sheet(workbook, suppliersSheet, 'REF FOURNISSEURS');

    // Stock Initial template
    const stockData = [
      ['Référence produit', 'Siège : neuf', 'Siège : occasion', 'Entrepôt : neuf', 'Entrepôt : occasion'],
      ['PROD-001', 10, 2, 5, 0],
    ];
    const stockSheet = XLSX.utils.aoa_to_sheet(stockData);
    XLSX.utils.book_append_sheet(workbook, stockSheet, 'STOCK INITIAL');

    // Movements template
    const movementsData = [
      ['Produit', 'Mouvement', 'Source', 'Cible', 'Qté', 'Date', 'Opérateur', 'Commentaire'],
      ['PROD-001', 'Déplacement', 'Siège : neuf', 'Entrepôt : neuf', 5, new Date(), 'John', 'Transfert mensuel'],
    ];
    const movementsSheet = XLSX.utils.aoa_to_sheet(movementsData);
    XLSX.utils.book_append_sheet(workbook, movementsSheet, 'MVT CLASSIK');

    // Orders template
    const ordersData = [
      ['Produit', 'Fournisseur', 'Qté', 'État commande', 'Destination', 'Date commande', 'Date prévue', 'Qté reçue', 'Responsable', 'Commentaire'],
      ['PROD-001', 'Fournisseur A', 10, 'En cours', 'Siège : neuf', new Date(), new Date(), null, 'John', 'Commande urgente'],
    ];
    const ordersSheet = XLSX.utils.aoa_to_sheet(ordersData);
    XLSX.utils.book_append_sheet(workbook, ordersSheet, 'COMMANDES CLASSIK');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=template_import.xlsx');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
