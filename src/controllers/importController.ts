import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { ImportResult } from '../services/import/types';
import { buildWorkbookPreview } from '../services/import/preview';
import { isFlatFormat, importFlatFormat } from '../services/import/flatFormat';
import { importSites } from '../services/import/sites';
import { importSuppliers, importProductSuppliers } from '../services/import/suppliers';
import { importProducts } from '../services/import/products';
import { importStockInitial } from '../services/import/stocks';
import { importMovements } from '../services/import/movements';
import { importOrders } from '../services/import/orders';
import { buildTemplateWorkbookBuffer } from '../services/import/template';

// Orchestrateur mince : la logique metier vit dans src/services/import/

// Preview import data without saving
export const previewImport = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError('Aucun fichier fourni', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const preview = buildWorkbookPreview(workbook);

  res.json({
    success: true,
    data: {
      fileName: req.file.originalname,
      sheets: preview,
      availableSheets: workbook.SheetNames,
    },
  });
});

// Full import from Excel file
export const importExcel = asyncHandler(async (req: Request, res: Response) => {
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
});

// Export templates
export const getExportTemplate = asyncHandler(async (req: Request, res: Response) => {
  const buffer = buildTemplateWorkbookBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=template_import.xlsx');
  res.send(buffer);
});
