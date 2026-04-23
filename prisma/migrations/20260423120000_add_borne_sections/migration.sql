-- CreateTable
CREATE TABLE "borne_sections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "borne_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "borne_sections_name_key" ON "borne_sections"("name");

-- Add sectionId column (nullable) before backfill
ALTER TABLE "construction_borne_items" ADD COLUMN "sectionId" TEXT;

-- Backfill: create a BorneSection for every distinct non-null section name,
-- then point construction_borne_items.sectionId at the matching section
INSERT INTO "borne_sections" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t.name, NOW(), NOW()
FROM (
    SELECT DISTINCT "section" AS name
    FROM "construction_borne_items"
    WHERE "section" IS NOT NULL AND "section" <> ''
) t;

UPDATE "construction_borne_items" ci
SET "sectionId" = bs."id"
FROM "borne_sections" bs
WHERE ci."section" = bs."name";

-- Drop the old text column now that data is migrated
ALTER TABLE "construction_borne_items" DROP COLUMN "section";

-- AddForeignKey
ALTER TABLE "construction_borne_items" ADD CONSTRAINT "construction_borne_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "borne_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
