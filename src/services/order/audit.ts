/**
 * Helpers to record activity on an Order timeline (OrderAuditLog).
 *
 * Designed to be invoked from controllers right after a successful mutation.
 * Each helper accepts the Prisma client (or a transactional client) and
 * returns the created row(s). Failures are swallowed by the caller — audit
 * entries are best-effort and must never block the main write.
 */

import type { PrismaClient, Prisma } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

interface Who {
  id?: string | null;
  name?: string | null;
}

const TRACKED_ORDER_FIELDS = [
  'title',
  'orderDate',
  'expectedDate',
  'destinationSiteId',
  'responsible',
  'supplierRef',
  'comment',
  'shippingCost',
] as const;

function toAuditValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    // Prisma Decimal etc.
    return String(v);
  }
  return String(v);
}

export interface OrderScalarDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export function diffOrderScalars(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): OrderScalarDiff[] {
  const diffs: OrderScalarDiff[] = [];
  for (const field of TRACKED_ORDER_FIELDS) {
    if (!(field in next)) continue;
    const oldNorm = toAuditValue(previous?.[field]);
    const newNorm = toAuditValue(next[field]);
    if (oldNorm === newNorm) continue;
    diffs.push({ field, oldValue: oldNorm, newValue: newNorm });
  }
  return diffs;
}

export async function recordCreated(tx: Tx, orderId: string, who: Who) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'created',
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}

export async function recordFieldChanges(
  tx: Tx,
  orderId: string,
  diffs: OrderScalarDiff[],
  who: Who,
) {
  if (diffs.length === 0) return;
  return tx.orderAuditLog.createMany({
    data: diffs.map((d) => ({
      orderId,
      action: 'field',
      field: d.field,
      oldValue: d.oldValue,
      newValue: d.newValue,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    })),
  });
}

export async function recordStatusChange(
  tx: Tx,
  orderId: string,
  fromStatus: string,
  toStatus: string,
  who: Who,
) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'status',
      oldValue: fromStatus,
      newValue: toStatus,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}

export async function recordItemReceived(
  tx: Tx,
  orderId: string,
  productLabel: string,
  receivedQty: number,
  who: Who,
) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'item_received',
      field: productLabel,
      newValue: String(receivedQty),
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}

export async function recordAnomaly(
  tx: Tx,
  orderId: string,
  productLabel: string,
  anomaly: { quantity: number; decision: 'ACCEPTED' | 'REFUSED'; comment: string },
  who: Who,
) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'item_anomaly',
      field: productLabel,
      oldValue: anomaly.decision, // ACCEPTED | REFUSED
      newValue: `${anomaly.quantity}|${anomaly.comment}`,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}

export async function recordAttachmentAdded(
  tx: Tx,
  orderId: string,
  filename: string,
  who: Who,
) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'attachment_added',
      field: filename,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}

export async function recordAttachmentRemoved(
  tx: Tx,
  orderId: string,
  filename: string,
  who: Who,
) {
  return tx.orderAuditLog.create({
    data: {
      orderId,
      action: 'attachment_removed',
      field: filename,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    },
  });
}
