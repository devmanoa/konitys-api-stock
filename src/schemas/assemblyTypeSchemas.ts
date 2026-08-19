import { z } from 'zod';
import { paginationSchema } from './common';

export const assemblyTypeItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive('La quantité doit être positive'),
  partCategoryId: z.string().uuid().optional().nullable(),
});

export const createAssemblyTypeSchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  description: z.string().optional(),
  items: z.array(assemblyTypeItemSchema).optional(),
});

export const updateAssemblyTypeSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').optional(),
  description: z.string().optional().nullable(),
  items: z.array(assemblyTypeItemSchema).optional(),
});

export const querySchema = paginationSchema.extend({
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  search: z.string().optional(),
});
