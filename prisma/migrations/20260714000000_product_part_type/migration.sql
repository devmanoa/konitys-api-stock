-- Type de piece (orthogonal aux PartCategory qui decrivent la localisation).
-- Utilise cote Factory pour grouper la checklist d'assemblage.

CREATE TYPE "PartType" AS ENUM ('EQUIPMENT', 'PROTECTION', 'HARDWARE');

ALTER TABLE "products"
  ADD COLUMN "partType" "PartType";

CREATE INDEX "products_partType_idx" ON "products"("partType");
