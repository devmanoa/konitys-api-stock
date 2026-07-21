-- Bascule PartType du Product vers la ProductCategory.
-- Rename HARDWARE -> ACCESSORY (Visserie -> Accessoire).
--
-- Les donnees Product.partType existantes sont des tags de test, on les
-- jette (cf. discussion). Les nouvelles categories seront taguees a la
-- main via l'admin Stock.

-- 1. Drop l'index et la colonne partType sur products.
DROP INDEX IF EXISTS "products_partType_idx";
ALTER TABLE "products" DROP COLUMN IF EXISTS "partType";

-- 2. Rename l'enum : HARDWARE -> ACCESSORY.
--    Sur PG 12+ ALTER TYPE ... RENAME VALUE fonctionne directement.
ALTER TYPE "PartType" RENAME VALUE 'HARDWARE' TO 'ACCESSORY';

-- 3. Ajoute la colonne partType sur product_categories (nullable) + index.
ALTER TABLE "product_categories"
  ADD COLUMN "partType" "PartType";

CREATE INDEX "product_categories_partType_idx" ON "product_categories"("partType");
