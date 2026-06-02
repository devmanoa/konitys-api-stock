-- Hierarchical storage locations attached to a Site
CREATE TABLE "locations" (
  "id"        TEXT NOT NULL,
  "siteId"    TEXT,
  "parentId"  TEXT,
  "name"      TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique within (site, parent) scope. NULLs are not compared in Postgres so
-- two roots without a site won't collide unless their names match exactly.
CREATE UNIQUE INDEX "locations_siteId_parentId_name_key"
  ON "locations"("siteId", "parentId", "name");

CREATE INDEX "locations_siteId_parentId_idx"
  ON "locations"("siteId", "parentId");

-- locationId on products (kept alongside legacy `location` text for backfill)
ALTER TABLE "products" ADD COLUMN "locationId" TEXT;

ALTER TABLE "products"
  ADD CONSTRAINT "products_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Naive backfill: every distinct non-empty Product.location value becomes an
-- orphan root-level location (no site, no parent). The product then points to
-- it. Users can later move these into proper site → category → sub-category
-- trees from the UI.
INSERT INTO "locations" ("id", "siteId", "parentId", "name", "position")
SELECT gen_random_uuid(), NULL, NULL, distinct_loc, 0
FROM (
  SELECT DISTINCT trim("location") AS distinct_loc
  FROM "products"
  WHERE "location" IS NOT NULL AND length(trim("location")) > 0
) src;

UPDATE "products" p
SET "locationId" = l.id
FROM "locations" l
WHERE p."location" IS NOT NULL
  AND length(trim(p."location")) > 0
  AND l."siteId" IS NULL
  AND l."parentId" IS NULL
  AND l."name" = trim(p."location");
