-- Add the new partCategoryId column on assembly_type_items
ALTER TABLE "assembly_type_items" ADD COLUMN "partCategoryId" TEXT;

-- Backfill: for every (assemblyTypeId, BorneSection.name) pair currently in use,
-- ensure a PartCategory exists with the same name scoped to that assembly type,
-- then point the item at it.
INSERT INTO "part_categories" ("id", "assemblyTypeId", "name", "createdAt")
SELECT gen_random_uuid(), pairs."assemblyTypeId", pairs."name", NOW()
FROM (
  SELECT DISTINCT ati."assemblyTypeId", bs."name"
  FROM "assembly_type_items" ati
  JOIN "borne_sections" bs ON bs."id" = ati."sectionId"
  WHERE ati."sectionId" IS NOT NULL
) AS pairs
ON CONFLICT ("assemblyTypeId", "name") DO NOTHING;

UPDATE "assembly_type_items" ati
SET "partCategoryId" = pc."id"
FROM "borne_sections" bs, "part_categories" pc
WHERE ati."sectionId" = bs."id"
  AND pc."assemblyTypeId" = ati."assemblyTypeId"
  AND pc."name" = bs."name";

-- Drop the old FK + column
ALTER TABLE "assembly_type_items" DROP CONSTRAINT IF EXISTS "assembly_type_items_sectionId_fkey";
ALTER TABLE "assembly_type_items" DROP COLUMN "sectionId";

-- Drop the now-unused borne_sections table
DROP TABLE IF EXISTS "borne_sections";

-- Add the new FK
ALTER TABLE "assembly_type_items" ADD CONSTRAINT "assembly_type_items_partCategoryId_fkey" FOREIGN KEY ("partCategoryId") REFERENCES "part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
