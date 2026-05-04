-- Make PartCategory global (no longer scoped per assembly type)
-- 1. Pick a "winner" id per name (oldest createdAt, fallback on id) — winners table
-- 2. Repoint all references on product_part_categories and assembly_type_items
-- 3. Delete the duplicate part_categories rows
-- 4. Drop FK + column assemblyTypeId, drop the (assemblyTypeId, name) unique, add unique(name)

CREATE TEMP TABLE _pc_winners AS
SELECT DISTINCT ON ("name")
  "name",
  "id" AS winner_id
FROM "part_categories"
ORDER BY "name", "createdAt" ASC, "id" ASC;

-- For product_part_categories: avoid violating the unique (productId, partCategoryId)
-- by deleting rows that would collide once redirected to the winner id
DELETE FROM "product_part_categories" ppc
USING "part_categories" pc, _pc_winners w
WHERE ppc."partCategoryId" = pc."id"
  AND pc."name" = w."name"
  AND pc."id" <> w.winner_id
  AND EXISTS (
    SELECT 1 FROM "product_part_categories" ppc2
    WHERE ppc2."productId" = ppc."productId"
      AND ppc2."partCategoryId" = w.winner_id
  );

UPDATE "product_part_categories" ppc
SET "partCategoryId" = w.winner_id
FROM "part_categories" pc, _pc_winners w
WHERE ppc."partCategoryId" = pc."id"
  AND pc."name" = w."name"
  AND pc."id" <> w.winner_id;

-- For assembly_type_items: same risk on the unique (assemblyTypeId, productId) is irrelevant,
-- but the partCategoryId can be repointed without conflict
UPDATE "assembly_type_items" ati
SET "partCategoryId" = w.winner_id
FROM "part_categories" pc, _pc_winners w
WHERE ati."partCategoryId" = pc."id"
  AND pc."name" = w."name"
  AND pc."id" <> w.winner_id;

-- Drop duplicates from part_categories
DELETE FROM "part_categories" pc
USING _pc_winners w
WHERE pc."name" = w."name"
  AND pc."id" <> w.winner_id;

DROP TABLE _pc_winners;

-- Now drop the (assemblyTypeId, name) unique and the FK + column
ALTER TABLE "part_categories" DROP CONSTRAINT IF EXISTS "part_categories_assemblyTypeId_name_key";
ALTER TABLE "part_categories" DROP CONSTRAINT IF EXISTS "part_categories_assemblyTypeId_fkey";
ALTER TABLE "part_categories" DROP COLUMN IF EXISTS "assemblyTypeId";

-- Make name unique globally
CREATE UNIQUE INDEX "part_categories_name_key" ON "part_categories"("name");
