import { z } from 'zod';
import { paginationSchema } from './common';

const orderItemSchema = z.object({
  productId: z.string().uuid('ID produit invalide'),
  quantity: z.number().int().positive('La quantité doit être positive'),
  unitPrice: z.number().positive('Le prix doit être positif').optional(),
});

export const createOrderSchema = z.object({
  supplierId: z.string().uuid('ID fournisseur invalide'),
  title: z.string().max(200).optional(),
  orderDate: z.coerce.date(),
  expectedDate: z.coerce.date().optional(),
  destinationSiteId: z.string().uuid().optional(),
  responsible: z.string().max(50).optional(),
  supplierRef: z.string().max(100).optional(),
  comment: z.string().optional(),
  shippingCost: z.number().min(0, 'Les frais doivent être positifs').optional().nullable(),
  createdBy: z.string().max(100).optional(),
  items: z.array(orderItemSchema).min(1, 'Au moins un produit est requis'),
});

export const updateOrderSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  orderDate: z.coerce.date().optional(),
  expectedDate: z.coerce.date().optional().nullable(),
  destinationSiteId: z.string().uuid().optional().nullable(),
  responsible: z.string().max(50).optional().nullable(),
  supplierRef: z.string().max(100).optional().nullable(),
  comment: z.string().optional().nullable(),
  shippingCost: z.number().min(0).optional().nullable(),
  status: z.enum(['PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED']).optional(),
});

const anomalyInputSchema = z.object({
  quantity: z.number().int().positive("La quantité d'anomalie doit être positive"),
  decision: z.enum(['ACCEPTED', 'REFUSED']),
  comment: z.string().min(1, 'Un commentaire est obligatoire pour signaler une anomalie'),
  photoUrls: z.array(z.string()).optional(),
});

export const receiveItemSchema = z.object({
  receivedDate: z.coerce.date(),
  receivedQty: z.number().int().min(0, 'La quantité reçue ne peut pas être négative'),
  condition: z.enum(['NEW', 'USED']).default('NEW'),
  siteId: z.string().uuid().optional(),
  comment: z.string().optional(),
  anomalies: z.array(anomalyInputSchema).optional(),
});

const receiveAllItemSchema = z.object({
  itemId: z.string().uuid(),
  receivedQty: z.number().int().min(0, 'La quantité reçue ne peut pas être négative'),
  condition: z.enum(['NEW', 'USED']).default('NEW'),
  anomalies: z.array(anomalyInputSchema).optional(),
});

export const receiveAllSchema = z.object({
  receivedDate: z.coerce.date(),
  siteId: z.string().uuid().optional(),
  comment: z.string().optional(),
  items: z.array(receiveAllItemSchema).min(1, 'Au moins un article est requis'),
});

export type ReceiveAllInput = z.infer<typeof receiveAllSchema>;

export const orderQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED']).optional(),
  supplierId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ReceiveItemInput = z.infer<typeof receiveItemSchema>;
export type OrderQueryInput = z.infer<typeof orderQuerySchema>;
