/**
 * Company lookup service.
 *
 * For SIRET/SIREN exact lookup we now hit the official INSEE Sirene API v3.11
 * (https://api.insee.fr/api-sirene/3.11/) because it is the authoritative
 * source — every other public API (recherche-entreprises, Pappers, etc.)
 * is built on top of it and may lag behind.
 *
 * For free-text search ("show me companies named 'Konitys'") we keep the
 * public Recherche-Entreprises API because INSEE only exposes structured
 * field queries, not full-text. If INSEE is unreachable we also fall back
 * to Recherche-Entreprises for the SIRET lookup, so the form never breaks.
 *
 * Auth: INSEE 3.11 requires a header `X-INSEE-Api-Key-Integration: <key>`
 * (set via the INSEE_API_KEY env var). Without it, only the fallback path
 * is used.
 *
 * Returns null on any failure so the caller can fail-open (the user can
 * still fill the fields manually).
 */

import { getNafLabel } from './nafLabels';

const INSEE_BASE = 'https://api.insee.fr/api-sirene/3.11';
const FALLBACK_BASE = 'https://recherche-entreprises.api.gouv.fr';

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

// ---------------- INSEE 3.11 lookup ----------------

interface InseeAdresseEtablissement {
  numeroVoieEtablissement?: string | null;
  typeVoieEtablissement?: string | null;
  libelleVoieEtablissement?: string | null;
  complementAdresseEtablissement?: string | null;
  codePostalEtablissement?: string | null;
  libelleCommuneEtablissement?: string | null;
}

interface InseePeriodeEtablissement {
  etatAdministratifEtablissement?: string | null;
  activitePrincipaleEtablissement?: string | null;
  dateFin?: string | null;
}

interface InseeUniteLegale {
  denominationUniteLegale?: string | null;
  nomUniteLegale?: string | null;
  prenom1UniteLegale?: string | null;
  etatAdministratifUniteLegale?: string | null;
  activitePrincipaleUniteLegale?: string | null;
  dateCreationUniteLegale?: string | null;
}

interface InseeEtablissement {
  siret?: string;
  siren?: string;
  dateCreationEtablissement?: string | null;
  uniteLegale?: InseeUniteLegale;
  adresseEtablissement?: InseeAdresseEtablissement;
  periodesEtablissement?: InseePeriodeEtablissement[];
}

function buildInseeAddress(a?: InseeAdresseEtablissement): string | null {
  if (!a) return null;
  const parts = [
    a.numeroVoieEtablissement,
    a.typeVoieEtablissement,
    a.libelleVoieEtablissement,
    a.complementAdresseEtablissement,
  ].filter(Boolean);
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

function buildLegalNameFromUL(ul?: InseeUniteLegale): string | null {
  if (!ul) return null;
  if (ul.denominationUniteLegale) return ul.denominationUniteLegale;
  // Personne physique fallback
  const personParts = [ul.prenom1UniteLegale, ul.nomUniteLegale].filter(Boolean);
  return personParts.length > 0 ? personParts.join(' ') : null;
}

function mapInseeEtablissement(et: InseeEtablissement): CompanyInfo {
  const ul = et.uniteLegale;
  // Periodes are sorted from most-recent to oldest by INSEE; the first one
  // with no dateFin is the current state.
  const currentPeriode = et.periodesEtablissement?.find((p) => !p.dateFin)
    ?? et.periodesEtablissement?.[0];
  const yearMatch = (ul?.dateCreationUniteLegale || et.dateCreationEtablissement || '').match(/^(\d{4})/);
  const naf = currentPeriode?.activitePrincipaleEtablissement
    || ul?.activitePrincipaleUniteLegale
    || null;
  return {
    siret: et.siret || null,
    siren: et.siren || (et.siret ? et.siret.slice(0, 9) : null),
    legalName: buildLegalNameFromUL(ul),
    legalStatus: currentPeriode?.etatAdministratifEtablissement
      || ul?.etatAdministratifUniteLegale
      || null,
    naf,
    nafLabel: getNafLabel(naf),
    creationYear: yearMatch ? Number(yearMatch[1]) : null,
    address: buildInseeAddress(et.adresseEtablissement),
    postalCode: et.adresseEtablissement?.codePostalEtablissement || null,
    city: et.adresseEtablissement?.libelleCommuneEtablissement || null,
  };
}

async function lookupByInsee(value: string): Promise<CompanyInfo | null> {
  const apiKey = process.env.INSEE_API_KEY;
  if (!apiKey) return null;
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 9 && clean.length !== 14) return null;

  // For a 9-digit SIREN, ask INSEE to return the head office (siège) by
  // filtering on etablissementSiege:true.
  const url = clean.length === 14
    ? `${INSEE_BASE}/siret/${clean}`
    : `${INSEE_BASE}/siret?q=siren:${clean}%20AND%20etablissementSiege:true&nombre=1`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-INSEE-Api-Key-Integration': apiKey,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      etablissement?: InseeEtablissement;
      etablissements?: InseeEtablissement[];
    };
    const et = json.etablissement || json.etablissements?.[0];
    return et ? mapInseeEtablissement(et) : null;
  } catch {
    return null;
  }
}

// ---------------- Recherche-Entreprises fallback ----------------

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

function mapHit(hit: RawCompanyHit): CompanyInfo {
  const yearMatch = (hit.date_creation || '').match(/^(\d{4})/);
  const siret = hit.siege?.siret || hit.matching_etablissements?.[0]?.siret || null;
  const siren = hit.siren || (siret ? siret.slice(0, 9) : null);
  return {
    siret,
    siren,
    legalName: hit.nom_complet || hit.nom_raison_sociale || null,
    legalStatus: hit.siege?.etat_administratif || hit.etat_administratif || null,
    naf: hit.activite_principale || null,
    nafLabel: hit.libelle_activite_principale || getNafLabel(hit.activite_principale),
    creationYear: yearMatch ? Number(yearMatch[1]) : null,
    address: hit.siege?.adresse || hit.matching_etablissements?.[0]?.adresse || null,
    postalCode: hit.siege?.code_postal || hit.matching_etablissements?.[0]?.code_postal || null,
    city: hit.siege?.libelle_commune || hit.matching_etablissements?.[0]?.libelle_commune || null,
  };
}

async function lookupByFallback(value: string): Promise<CompanyInfo | null> {
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 9 && clean.length !== 14) return null;
  const url = `${FALLBACK_BASE}/search?q=${encodeURIComponent(clean)}&page=1&per_page=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: RawCompanyHit[] };
    const hit = json.results?.[0];
    return hit ? mapHit(hit) : null;
  } catch {
    return null;
  }
}

// ---------------- Public API ----------------

/**
 * Look up a company by its SIREN (9 digits) or SIRET (14 digits).
 * Tries INSEE first (authoritative), falls back to Recherche-Entreprises
 * if INSEE is unavailable or no key is configured.
 */
export async function lookupBySiret(value: string): Promise<CompanyInfo | null> {
  const fromInsee = await lookupByInsee(value);
  if (fromInsee) return fromInsee;
  return lookupByFallback(value);
}

/**
 * Free-text lookup (used by the inline search field on the supplier form).
 * INSEE 3.11 does not provide a real full-text search, so this keeps using
 * Recherche-Entreprises which is built for that purpose.
 */
export async function searchByText(
  query: string,
  limit = 5,
): Promise<CompanyInfo[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = `${FALLBACK_BASE}/search?q=${encodeURIComponent(trimmed)}&page=1&per_page=${limit}`;
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
