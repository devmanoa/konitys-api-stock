// Types partages entre les modules d'import Excel

export interface ImportResult {
  products: { created: number; updated: number; errors: string[] };
  suppliers: { created: number; updated: number; errors: string[] };
  productSuppliers: { created: number; updated: number; errors: string[] };
  sites: { created: number; errors: string[] };
  stocks: { created: number; updated: number; errors: string[] };
  movements: { created: number; errors: string[] };
  orders: { created: number; errors: string[] };
}
