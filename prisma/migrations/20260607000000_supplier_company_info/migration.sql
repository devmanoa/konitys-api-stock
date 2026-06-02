-- Company data fetched from recherche-entreprises.api.gouv.fr
ALTER TABLE "suppliers"
  ADD COLUMN "siret"                TEXT,
  ADD COLUMN "siren"                TEXT,
  ADD COLUMN "legalName"            TEXT,
  ADD COLUMN "legalStatus"          TEXT,
  ADD COLUMN "naf"                  TEXT,
  ADD COLUMN "nafLabel"             TEXT,
  ADD COLUMN "creationYear"         INTEGER,
  ADD COLUMN "companyInfoUpdatedAt" TIMESTAMP(3);

CREATE INDEX "suppliers_siret_idx" ON "suppliers"("siret");
