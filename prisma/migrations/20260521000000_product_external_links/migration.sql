-- Replace the single Product.externalUrl column with a many-to-one
-- product_external_links table, preserving existing values via a backfill.

CREATE TABLE "product_external_links" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_external_links_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_external_links"
  ADD CONSTRAINT "product_external_links_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "product_external_links_productId_position_idx"
  ON "product_external_links"("productId", "position");

-- Backfill: every non-empty Product.externalUrl becomes one row in the new
-- table. gen_random_uuid() requires pgcrypto, which is present on the
-- managed Postgres used by Coolify.
INSERT INTO "product_external_links" ("id", "productId", "url", "position")
SELECT gen_random_uuid(), "id", "externalUrl", 0
FROM "products"
WHERE "externalUrl" IS NOT NULL AND length(trim("externalUrl")) > 0;

ALTER TABLE "products" DROP COLUMN "externalUrl";
