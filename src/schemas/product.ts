import { z } from 'zod';

export const createProductSchema = z.object({
  // Optionnel : si absent ET que productCategoryId + brand + model sont
  // fournis, la ref sera générée automatiquement côté controller.
  reference: z.string().max(50).optional(),
  /**
   * Nom lisible affiché aux utilisateurs (ex : "Imprimante DNP DS620").
   * Peut différer de la référence interne.
   */
  name: z.string().max(120).optional().nullable(),
  description: z.string().max(255).optional(),
  supplyRisk: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  /**
   * Catégorie principale (Imprimante / PC / Écran / ...) — sert de
   * préfixe pour la génération auto de la référence. Porte aussi le
   * partType (Équipement / Protection / Accessoire) qui remplace
   * l'ancien Product.partType.
   */
  productCategoryId: z.string().uuid().optional().nullable(),
  brand: z.string().max(40).optional().nullable(),
  model: z.string().max(60).optional().nullable(),
  variant: z.string().max(40).optional().nullable(),
  location: z.string().max(20).optional(),
  locationId: z.string().uuid().optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable().transform(val => val || undefined),
  assemblyTypes: z
    .array(
      z.object({
        assemblyTypeId: z.string().uuid(),
        qtyPerUnit: z.number().int().positive().default(1),
      }),
    )
    .optional(),
  comment: z.string().optional(),
  imageUrl: z.string().optional().or(z.literal('')).transform(val => val || undefined),
  externalLinks: z
    .array(z.string().url('URL invalide').max(2048))
    .optional(),
  minStock: z.number().int().min(0).optional().nullable(),
  partCategoryIds: z.array(z.string().uuid()).optional(),
  hasSerialNumber: z.boolean().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(10000).default(20),
  search: z.string().optional(),
  supplyRisk: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  supplierId: z.string().uuid().optional(),
  assemblyId: z.string().uuid().optional(),
  assemblyTypeId: z.string().uuid().optional(),
  partCategoryId: z.string().uuid().optional(),
  productCategoryId: z.string().uuid().optional(),
  hasSerialNumber: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sortBy: z.string().default('reference'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
