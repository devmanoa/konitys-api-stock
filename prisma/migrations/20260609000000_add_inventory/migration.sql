-- CreateEnum
CREATE TYPE "InventoryItemState" AS ENUM ('OK', 'TO_CHECK', 'DAMAGED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "InventoryEntrySource" AS ENUM ('SCAN', 'SEARCH', 'CATEGORY', 'UNKNOWN');

-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_entries" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "locationId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "state" "InventoryItemState" NOT NULL DEFAULT 'OK',
    "comment" TEXT,
    "photoUrl" TEXT,
    "source" "InventoryEntrySource" NOT NULL DEFAULT 'SEARCH',
    "operatorId" TEXT,
    "operatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_unknown_entries" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "locationId" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "comment" TEXT,
    "photoUrl" TEXT,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_unknown_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_entries_inventoryId_locationId_idx" ON "inventory_entries"("inventoryId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_entries_inventoryId_productId_idx" ON "inventory_entries"("inventoryId", "productId");

-- CreateIndex
CREATE INDEX "inventory_entries_inventoryId_serialNumber_idx" ON "inventory_entries"("inventoryId", "serialNumber");

-- CreateIndex
CREATE INDEX "inventory_unknown_entries_inventoryId_locationId_idx" ON "inventory_unknown_entries"("inventoryId", "locationId");

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unknown_entries" ADD CONSTRAINT "inventory_unknown_entries_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unknown_entries" ADD CONSTRAINT "inventory_unknown_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
