import * as XLSX from 'xlsx';
import prisma from '../../config/database';

// Helpers de parsing communs a tous les modules d'import

// Helper to get sheet data as objects
export function getSheetData(workbook: XLSX.WorkBook, sheetName: string): any[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet);
}

// Helper to find sheet by partial name
export function findSheet(workbook: XLSX.WorkBook, partialName: string): string | undefined {
  return workbook.SheetNames.find(name =>
    name.toLowerCase().includes(partialName.toLowerCase())
  );
}

export function mapSupplyRisk(value: any): 'HIGH' | 'MEDIUM' | 'LOW' | null {
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

export function parseExcelDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date
    return new Date((value - 25569) * 86400 * 1000);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export async function parseSiteCondition(value: string | undefined): Promise<{ siteId: string | null; condition: 'NEW' | 'USED' | null }> {
  if (!value) return { siteId: null, condition: null };

  const parts = value.split(':');
  const siteName = parts[0].trim();
  const conditionStr = parts[1]?.trim().toLowerCase();

  const site = await prisma.site.findFirst({ where: { name: siteName } });
  const condition = conditionStr?.includes('occasion') ? 'USED' : conditionStr?.includes('neuf') ? 'NEW' : null;

  return { siteId: site?.id || null, condition };
}
