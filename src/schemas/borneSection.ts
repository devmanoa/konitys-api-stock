import { z } from 'zod';

export const createBorneSectionSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(100),
});

export const updateBorneSectionSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(100),
});

export type CreateBorneSectionInput = z.infer<typeof createBorneSectionSchema>;
export type UpdateBorneSectionInput = z.infer<typeof updateBorneSectionSchema>;
