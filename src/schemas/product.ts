import { z } from 'zod';

export const createProductSchema = z.object({
  reference: z.string().min(1, 'La référence est requise').max(50),
  description: z.string().max(255).optional(),
  supplyRisk: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  location: z.string().max(20).optional(),
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
