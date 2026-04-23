-- CreateTable
CREATE TABLE "construction_bornes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "construction_bornes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_borne_items" (
    "id" TEXT NOT NULL,
    "borneId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "section" TEXT,

    CONSTRAINT "construction_borne_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "construction_bornes_name_key" ON "construction_bornes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "construction_borne_items_borneId_productId_key" ON "construction_borne_items"("borneId", "productId");

-- AddForeignKey
ALTER TABLE "construction_borne_items" ADD CONSTRAINT "construction_borne_items_borneId_fkey" FOREIGN KEY ("borneId") REFERENCES "construction_bornes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_borne_items" ADD CONSTRAINT "construction_borne_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
