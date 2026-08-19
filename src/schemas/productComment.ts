import { z } from 'zod';
import { paginationSchema } from './common';

export const createProductCommentSchema = z.object({
  content: z.string().min(1, 'Le commentaire ne peut pas être vide').max(2000),
});

export const updateProductCommentSchema = z.object({
  content: z.string().min(1, 'Le commentaire ne peut pas être vide').max(2000),
});

export const productCommentQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().positive().max(100).default(50),
});
