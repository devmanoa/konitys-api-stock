-- Dedupe PartCategory entries that are the same up to whitespace and casing,
-- normalize remaining names (Trim + first letter uppercase, rest lowercase),
-- and forbid future case-insensitive duplicates.

-- Step 1: trim leading/trailing whitespace
UPDATE "part_categories" SET "name" = TRIM("name") WHERE "name" <> TRIM("name");

-- Step 2: pick a winner per LOWER(name). Winner = the one with the most
-- references (product_part_categories + assembly_type_items), oldest as tie break.
CREATE TEMP TABLE _pc_winners AS
WITH counts AS (
  SELECT
    pc."id",
    LOWER(pc."name") AS lname,
    pc."createdAt",
    COALESCE((SELECT COUNT(*) FROM "product_part_categories" ppc WHERE ppc."partCategoryId" = pc."id"), 0)
      + COALESCE((SELECT COUNT(*) FROM "assembly_type_items" ati WHERE ati."partCategoryId" = pc."id"), 0)
      AS ref_count
  FROM "part_categories" pc
)
SELECT DISTINCT ON (lname)
  lname,
  "id" AS winner_id
FROM counts
ORDER BY lname, ref_count DESC, "createdAt" ASC, "id" ASC;

-- Step 3: avoid violating the (productId, partCategoryId) unique on
-- product_part_categories by removing collisions before redirecting.
DELETE FROM "product_part_categories" ppc
USING "part_categories" pc, _pc_winners w
WHERE ppc."partCategoryId" = pc."id"
  AND LOWER(pc."name") = w.lname
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
  AND LOWER(pc."name") = w.lname
  AND pc."id" <> w.winner_id;

-- Step 4: same for assembly_type_items (no problematic unique to dodge)
UPDATE "assembly_type_items" ati
SET "partCategoryId" = w.winner_id
FROM "part_categories" pc, _pc_winners w
WHERE ati."partCategoryId" = pc."id"
  AND LOWER(pc."name") = w.lname
  AND pc."id" <> w.winner_id;

-- Step 5: delete the losing duplicates
DELETE FROM "part_categories" pc
USING _pc_winners w
WHERE LOWER(pc."name") = w.lname
  AND pc."id" <> w.winner_id;

DROP TABLE _pc_winners;

-- Step 6: normalize remaining names → first character uppercased, rest lowercased.
-- Use INITCAP for the first char only by combining UPPER+SUBSTRING+LOWER+SUBSTRING.
UPDATE "part_categories"
SET "name" = UPPER(SUBSTRING("name" FROM 1 FOR 1)) || LOWER(SUBSTRING("name" FROM 2));

-- Step 7: drop the existing case-sensitive unique (added in 20260424180000)
-- and replace it by a case-insensitive one on LOWER(name).
DROP INDEX IF EXISTS "part_categories_name_key";
CREATE UNIQUE INDEX "part_categories_name_lower_key" ON "part_categories" (LOWER("name"));
