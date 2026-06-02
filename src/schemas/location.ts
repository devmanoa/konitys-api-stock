import { z } from 'zod';

export const createLocationSchema = z.object({
  siteId: z.string().uuid().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Le nom est requis').max(100),
  position: z.number().int().min(0).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.number().int().min(0).optional(),
});

export const locationQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationQueryInput = z.infer<typeof locationQuerySchema>;
