/**
 * Lookup table for the NAF révision 2 nomenclature.
 *
 * INSEE returns the activity as a code only (e.g. "01.11Z" or "0111Z" depending
 * on the source). We resolve the human-readable label locally from the
 * @socialgouv/codes-naf snapshot — that lib ships the official INSEE CSV in
 * JSON form.
 */

import codesNaf from '@socialgouv/codes-naf';

type NafEntry = { id: string; label: string };

const entries = codesNaf as NafEntry[];

// Build a case-insensitive map for O(1) lookups, indexed by both formats:
//   - "0111Z" (no dot) — the historical INSEE format
//   - "01.11Z" (with dot) — the modern Sirene API format
const byId = new Map<string, string>();
for (const e of entries) {
  byId.set(e.id.toUpperCase(), e.label);
  byId.set(e.id.replace(/\./g, '').toUpperCase(), e.label);
}

export function getNafLabel(code?: string | null): string | null {
  if (!code) return null;
  const normalised = code.trim().toUpperCase();
  return byId.get(normalised) || byId.get(normalised.replace(/\./g, '')) || null;
}
