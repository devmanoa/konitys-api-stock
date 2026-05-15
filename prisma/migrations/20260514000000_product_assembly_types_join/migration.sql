-- Make Product↔AssemblyType many-to-many with per-pair qtyPerUnit
-- Replaces Product.assemblyTypeId and Product.qtyPerUnit.

-- 1. Create the join table
CREATE TABLE "product_assembly_types" (
  "productId"      TEXT NOT NULL,
  "assemblyTypeId" TEXT NOT NULL,
  "qtyPerUnit"     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "product_assembly_types_pkey" PRIMARY KEY ("productId", "assemblyTypeId")
);

ALTER TABLE "product_assembly_types"
  ADD CONSTRAINT "product_assembly_types_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_assembly_types"
  ADD CONSTRAINT "product_assembly_types_assemblyTypeId_fkey"
  FOREIGN KEY ("assemblyTypeId") REFERENCES "assembly_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill from the existing single-link column, preserving qtyPerUnit
INSERT INTO "product_assembly_types" ("productId", "assemblyTypeId", "qtyPerUnit")
SELECT "id", "assemblyTypeId", COALESCE("qtyPerUnit", 1)
FROM "products"
WHERE "assemblyTypeId" IS NOT NULL;

-- 3. Drop the now-redundant columns on products
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_assemblyTypeId_fkey";
ALTER TABLE "products" DROP COLUMN "assemblyTypeId";
ALTER TABLE "products" DROP COLUMN "qtyPerUnit";
