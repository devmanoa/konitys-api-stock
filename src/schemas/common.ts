import { z } from 'zod';

/**
 * Pagination commune a tous les schemas de query.
 * Les schemas dont les bornes divergent (ex: limit max 10000 pour les
 * listes produits/fournisseurs) overrident le champ via .extend().
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
