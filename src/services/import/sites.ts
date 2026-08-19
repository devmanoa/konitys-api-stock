import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { ImportResult } from './types';
import { findSheet, getSheetData } from './parsing';

// Import sites from sheet headers or dedicated sheet
export async function importSites(workbook: XLSX.WorkBook, result: ImportResult) {
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
