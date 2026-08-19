import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { getSheetData, mapSupplyRisk, parseExcelDate } from './parsing';

// Format plat : chaque feuille = un type d'assemblage, lignes = produit + fournisseur combines

// Detect if workbook uses the flat format (sheets = assembly types with product+supplier in same rows)
export function isFlatFormat(workbook: XLSX.WorkBook): boolean {
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
export async function importFlatFormat(workbook: any, result: ImportResult) {
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
        const qtyForRow = Math.max(
          1,
          parseInt(row['Quantité pour 1 borne']) || parseInt(row['Qté 1 borne']) || 1,
        );

        if (existing) {
          // Product already exists: only update imageUrl if we have a new image
          const updateData: any = {};
          if (imageData) {
            updateData.imageUrl = saveProductImage(imageData.buffer, imageData.ext);
          }
          if (Object.keys(updateData).length > 0) {
            await prisma.product.update({ where: { reference }, data: updateData });
          }
          // Upsert the (product, assemblyType) link with the row's qtyPerUnit
          await prisma.productAssemblyType.upsert({
            where: {
              productId_assemblyTypeId: {
                productId: existing.id,
                assemblyTypeId: assemblyType.id,
              },
            },
            create: {
              productId: existing.id,
              assemblyTypeId: assemblyType.id,
              qtyPerUnit: qtyForRow,
            },
            update: { qtyPerUnit: qtyForRow },
          });
          result.products.updated++;
        } else {
          // New product: create with all fields
          const productData: any = {
            reference,
            description: row['Description']?.toString() || null,
            supplyRisk: mapSupplyRisk(row['Risques appro'] || row['Risque appro']),
            location: (row['Emplacement de stockage'] || row['Emplacement'])?.toString() || null,
          };
          if (imageData) {
            productData.imageUrl = saveProductImage(imageData.buffer, imageData.ext);
          }
          const created = await prisma.product.create({ data: productData });
          await prisma.productAssemblyType.create({
            data: {
              productId: created.id,
              assemblyTypeId: assemblyType.id,
              qtyPerUnit: qtyForRow,
            },
          });
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
