import * as XLSX from 'xlsx';

export interface SheetPreview {
  headers: string[];
  rows: number;
  sample: any[];
}

// Construit l'apercu (headers, nb de lignes, echantillon) de chaque feuille du classeur
export function buildWorkbookPreview(workbook: XLSX.WorkBook): Record<string, SheetPreview> {
  const preview: Record<string, SheetPreview> = {};

  workbook.SheetNames.forEach((name) => {
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

  return preview;
}
