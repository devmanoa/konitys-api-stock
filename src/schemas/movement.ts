import { z } from 'zod';

export const createMovementSchema = z.object({
  productId: z.string().uuid('ID produit invalide'),
  type: z.enum(['IN', 'OUT', 'TRANSFER']),
  sourceSiteId: z.string().uuid().optional(),
  targetSiteId: z.string().uuid().optional(),
  quantity: z.number().int().positive('La quantité doit être positive'),
  condition: z.enum(['NEW', 'USED']),
  movementDate: z.coerce.date(),
  operator: z.string().max(50).optional(),
  comment: z.string().optional(),
  // Serial-tracked products only
  serialNumbers: z.array(z.string().max(100)).optional(),
  serialItemIds: z.array(z.string().uuid()).optional(),
  borneNumber: z.string().max(200).optional(),
}).refine((data) => {
  // Pour un transfert, source et cible sont requis
  if (data.type === 'TRANSFER') {
    return data.sourceSiteId && data.targetSiteId;
  }
  // Pour une entrée, la cible est requise
  if (data.type === 'IN') {
    return data.targetSiteId;
  }
  // Pour une sortie, la source est requise
  if (data.type === 'OUT') {
    return data.sourceSiteId;
  }
  return true;
}, {
  message: 'Sites source/cible invalides pour ce type de mouvement',
});

export const movementQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  productId: z.string().uuid().optional(),
  type: z.enum(['IN', 'OUT', 'TRANSFER']).optional(),
  siteId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  operator: z.string().optional(),
});

export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type MovementQueryInput = z.infer<typeof movementQuerySchema>;
