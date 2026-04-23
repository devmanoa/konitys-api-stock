import { z } from 'zod';

export const constructionBorneItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive('La quantité doit être positive'),
  section: z.string().max(100).optional().nullable(),
});

export const createConstructionBorneSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(100),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  items: z.array(constructionBorneItemSchema).min(1, 'Au moins un composant est requis'),
});

export const updateConstructionBorneSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(100).optional(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  items: z.array(constructionBorneItemSchema).min(1, 'Au moins un composant est requis').optional(),
});

export type CreateConstructionBorneInput = z.infer<typeof createConstructionBorneSchema>;
export type UpdateConstructionBorneInput = z.infer<typeof updateConstructionBorneSchema>;
