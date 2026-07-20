-- Lot 2 : lien Product -> ProductCategory + champs structures pour la
-- generation automatique de la reference interne.

ALTER TABLE "products"
  ADD COLUMN "name"              TEXT,
  ADD COLUMN "productCategoryId" TEXT,
  ADD COLUMN "brand"             TEXT,
  ADD COLUMN "model"             TEXT,
  ADD COLUMN "variant"           TEXT;

CREATE INDEX "products_productCategoryId_idx" ON "products"("productCategoryId");

ALTER TABLE "products"
  ADD CONSTRAINT "products_productCategoryId_fkey"
  FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
