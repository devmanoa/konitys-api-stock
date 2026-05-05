import { z } from 'zod';

export const serialStatusEnum = z.enum(['IN_STOCK', 'OUT', 'IN_REPAIR', 'SCRAPPED', 'LOST']);
export const conditionEnum = z.enum(['NEW', 'USED']);

export const createSerialItemSchema = z.object({
  serialNumber: z.string().max(100).optional().nullable(),
  condition: conditionEnum,
  siteId: z.string().uuid().optional().nullable(),
  status: serialStatusEnum.optional(),
  borneNumber: z.string().max(200).optional().nullable(),
  comment: z.string().max(2000).optional().nullable(),
});

export const updateSerialItemSchema = z.object({
  serialNumber: z.string().max(100).optional().nullable(),
  condition: conditionEnum.optional(),
  siteId: z.string().uuid().optional().nullable(),
  status: serialStatusEnum.optional(),
  borneNumber: z.string().max(200).optional().nullable(),
  comment: z.string().max(2000).optional().nullable(),
});

export const listSerialItemsQuerySchema = z.object({
  status: serialStatusEnum.optional(),
  siteId: z.string().uuid().optional(),
  condition: conditionEnum.optional(),
  search: z.string().optional(),
});

export type CreateSerialItemInput = z.infer<typeof createSerialItemSchema>;
export type UpdateSerialItemInput = z.infer<typeof updateSerialItemSchema>;
