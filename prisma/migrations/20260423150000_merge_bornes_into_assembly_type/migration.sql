-- Drop ConstructionBorne tables (no data migration requested)
DROP TABLE IF EXISTS "construction_borne_items";
DROP TABLE IF EXISTS "construction_bornes";

-- CreateTable
CREATE TABLE "assembly_type_items" (
    "id" TEXT NOT NULL,
    "assemblyTypeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sectionId" TEXT,

    CONSTRAINT "assembly_type_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assembly_type_items_assemblyTypeId_productId_key" ON "assembly_type_items"("assemblyTypeId", "productId");

-- AddForeignKey
ALTER TABLE "assembly_type_items" ADD CONSTRAINT "assembly_type_items_assemblyTypeId_fkey" FOREIGN KEY ("assemblyTypeId") REFERENCES "assembly_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_type_items" ADD CONSTRAINT "assembly_type_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_type_items" ADD CONSTRAINT "assembly_type_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "borne_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
