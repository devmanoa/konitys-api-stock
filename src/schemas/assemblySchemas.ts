import { z } from 'zod';
import { paginationSchema } from './common';

export const createAssemblySchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  description: z.string().optional(),
  assemblyTypeIds: z.array(z.string().uuid()).optional(),
});

export const updateAssemblySchema = z.object({
  name: z.string().min(1, 'Le nom est requis').optional(),
  description: z.string().optional().nullable(),
  assemblyTypeIds: z.array(z.string().uuid()).optional(),
});

export const querySchema = paginationSchema.extend({
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  search: z.string().optional(),
});
