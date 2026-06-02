/**
 * Wrapper around the free public API "Recherche d'entreprises" published by
 * the French State (https://api.gouv.fr/les-api/api-recherche-entreprises).
 *
 * It is unauthenticated, rate-limited at 7 req/s/IP, and exposes the official
 * SIRENE registry. We only use a couple of fields:
 *  - identité (nom officiel, SIREN, SIRET du siège)
 *  - état administratif (Actif / Cessé)
 *  - NAF + libellé activité
 *  - date de création → on en garde l'année
 *
 * Returns null on any failure so the caller can fail-open (the user can
 * still fill the fields manually).
 */

const API_BASE = 'https://recherche-entreprises.api.gouv.fr';

export interface CompanyInfo {
  siret: string | null;
  siren: string | null;
  legalName: string | null;
  /// 'A' actif, 'C' cessé/fermé. Same convention as INSEE.
  legalStatus: string | null;
  naf: string | null;
  nafLabel: string | null;
  creationYear: number | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
}

interface RawCompanyHit {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  etat_administratif?: string | null;
  activite_principale?: string | null;
  libelle_activite_principale?: string | null;
  date_creation?: string | null;
  siege?: {
    siret?: string | null;
    adresse?: string | null;
    code_postal?: string | null;
    libelle_commune?: string | null;
    etat_administratif?: string | null;
  } | null;
  matching_etablissements?: Array<{
    siret?: string | null;
    etat_administratif?: string | null;
    adresse?: string | null;
    code_postal?: string | null;
    libelle_commune?: string | null;
  }>;
}

function pickFirstHit(json: any): RawCompanyHit | null {
  if (!json || !Array.isArray(json.results) || json.results.length === 0) return null;
  return json.results[0] as RawCompanyHit;
}

function mapHit(hit: RawCompanyHit): CompanyInfo {
  const yearMatch = (hit.date_creation || '').match(/^(\d{4})/);
  // Prefer the head office's SIRET when the API returns it, otherwise fall
  // back to the first matching établissement.
  const siret =
    hit.siege?.siret ||
    hit.matching_etablissements?.[0]?.siret ||
    null;
  const siren = hit.siren || (siret ? siret.slice(0, 9) : null);
  return {
    siret,
    siren,
    legalName: hit.nom_complet || hit.nom_raison_sociale || null,
    legalStatus: hit.siege?.etat_administratif || hit.etat_administratif || null,
    naf: hit.activite_principale || null,
    nafLabel: hit.libelle_activite_principale || null,
    creationYear: yearMatch ? Number(yearMatch[1]) : null,
    address: hit.siege?.adresse || hit.matching_etablissements?.[0]?.adresse || null,
    postalCode: hit.siege?.code_postal || hit.matching_etablissements?.[0]?.code_postal || null,
    city: hit.siege?.libelle_commune || hit.matching_etablissements?.[0]?.libelle_commune || null,
  };
}

/**
 * Look up a company by its SIREN (9 digits) or SIRET (14 digits).
 */
export async function lookupBySiret(value: string): Promise<CompanyInfo | null> {
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 9 && clean.length !== 14) return null;
  const key = clean.length === 14 ? 'q' : 'q';
  // The Recherche Entreprises API accepts both SIREN/SIRET as a `q` parameter.
  const url = `${API_BASE}/search?${key}=${encodeURIComponent(clean)}&page=1&per_page=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const hit = pickFirstHit(json);
    return hit ? mapHit(hit) : null;
  } catch {
    return null;
  }
}

/**
 * Free-text lookup (used by the inline search field on the supplier form).
 * Returns up to `limit` hits.
 */
export async function searchByText(
  query: string,
  limit = 5,
): Promise<CompanyInfo[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = `${API_BASE}/search?q=${encodeURIComponent(trimmed)}&page=1&per_page=${limit}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: RawCompanyHit[] };
    if (!Array.isArray(json.results)) return [];
    return json.results.map(mapHit);
  } catch {
    return [];
  }
}
