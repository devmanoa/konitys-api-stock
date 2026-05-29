/**
 * Diff helpers for Product audit log.
 *
 * The product update endpoint passes the previous and next state through these
 * helpers to emit one ProductAuditLog row per change (scalar field, assembly
 * type link, part category, supplier).
 */

type ScalarMap = Record<string, unknown>;

interface AuditEntryBase {
  productId: string;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  changedById?: string | null;
  changedByName?: string | null;
}

/** Convert any value to the audit log's String? column (null preserved). */
function toAuditValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}

const TRACKED_SCALAR_FIELDS = [
  'reference',
  'description',
  'supplyRisk',
  'location',
  'comment',
  'imageUrl',
  'minStock',
  'hasSerialNumber',
  'assemblyId',
] as const;

export function diffScalars(
  productId: string,
  previous: ScalarMap | null,
  next: ScalarMap,
  who: { id?: string | null; name?: string | null },
): AuditEntryBase[] {
  const entries: AuditEntryBase[] = [];
  for (const field of TRACKED_SCALAR_FIELDS) {
    // Only emit a diff if `field` is present in the incoming payload — otherwise
    // it means the client didn't touch it.
    if (!(field in next)) continue;
    const oldRaw = previous?.[field];
    const newRaw = next[field];
    const oldNorm = toAuditValue(oldRaw);
    const newNorm = toAuditValue(newRaw);
    if (oldNorm === newNorm) continue;
    entries.push({
      productId,
      action: previous ? 'field' : 'created',
      field,
      oldValue: oldNorm,
      newValue: newNorm,
      changedById: who.id ?? null,
      changedByName: who.name ?? null,
    });
  }
  return entries;
}

type AssemblyTypeLink = { assemblyTypeId: string; qtyPerUnit: number };
type AssemblyTypeRef = { id: string; name: string };

export function diffAssemblyTypes(
  productId: string,
  previous: (AssemblyTypeLink & { assemblyType?: AssemblyTypeRef })[] | null,
  next: AssemblyTypeLink[] | undefined,
  types: AssemblyTypeRef[],
  who: { id?: string | null; name?: string | null },
): AuditEntryBase[] {
  if (!next) return [];
  const entries: AuditEntryBase[] = [];
  const prevMap = new Map<string, number>();
  for (const p of previous || []) prevMap.set(p.assemblyTypeId, p.qtyPerUnit);
  const nextMap = new Map<string, number>();
  for (const n of next) nextMap.set(n.assemblyTypeId, n.qtyPerUnit);
  const nameOf = (id: string) => types.find((t) => t.id === id)?.name || id;
  const baseWho = { changedById: who.id ?? null, changedByName: who.name ?? null };

  // Removed
  for (const [id, qty] of prevMap) {
    if (!nextMap.has(id)) {
      entries.push({
        productId,
        action: 'assembly_type_removed',
        field: nameOf(id),
        oldValue: String(qty),
        newValue: null,
        ...baseWho,
      });
    }
  }
  // Added or qty changed
  for (const [id, qty] of nextMap) {
    if (!prevMap.has(id)) {
      entries.push({
        productId,
        action: 'assembly_type_added',
        field: nameOf(id),
        oldValue: null,
        newValue: String(qty),
        ...baseWho,
      });
    } else if (prevMap.get(id) !== qty) {
      entries.push({
        productId,
        action: 'assembly_type_qty',
        field: nameOf(id),
        oldValue: String(prevMap.get(id)),
        newValue: String(qty),
        ...baseWho,
      });
    }
  }
  return entries;
}

export function diffExternalLinks(
  productId: string,
  previous: string[] | null,
  next: string[] | undefined,
  who: { id?: string | null; name?: string | null },
): AuditEntryBase[] {
  if (!next) return [];
  const entries: AuditEntryBase[] = [];
  const prev = new Set(previous || []);
  const cur = new Set(next);
  const baseWho = { changedById: who.id ?? null, changedByName: who.name ?? null };
  for (const url of prev) {
    if (!cur.has(url)) {
      entries.push({
        productId,
        action: 'external_link_removed',
        field: 'Lien externe',
        oldValue: url,
        newValue: null,
        ...baseWho,
      });
    }
  }
  for (const url of cur) {
    if (!prev.has(url)) {
      entries.push({
        productId,
        action: 'external_link_added',
        field: 'Lien externe',
        oldValue: null,
        newValue: url,
        ...baseWho,
      });
    }
  }
  return entries;
}

type PartCategoryRef = { id: string; name: string };

export function diffPartCategories(
  productId: string,
  previous: string[] | null,
  next: string[] | undefined,
  categories: PartCategoryRef[],
  who: { id?: string | null; name?: string | null },
): AuditEntryBase[] {
  if (!next) return [];
  const entries: AuditEntryBase[] = [];
  const prev = new Set(previous || []);
  const cur = new Set(next);
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name || id;
  const baseWho = { changedById: who.id ?? null, changedByName: who.name ?? null };

  for (const id of prev) {
    if (!cur.has(id)) {
      entries.push({
        productId,
        action: 'part_category_removed',
        field: nameOf(id),
        ...baseWho,
      });
    }
  }
  for (const id of cur) {
    if (!prev.has(id)) {
      entries.push({
        productId,
        action: 'part_category_added',
        field: nameOf(id),
        ...baseWho,
      });
    }
  }
  return entries;
}
