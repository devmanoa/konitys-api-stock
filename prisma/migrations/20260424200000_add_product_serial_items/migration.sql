-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('IN_STOCK', 'OUT', 'IN_REPAIR', 'SCRAPPED', 'LOST');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "hasSerialNumber" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_serial_items" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serialNumber" TEXT,
    "condition" "ProductCondition" NOT NULL,
    "siteId" TEXT,
    "status" "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "customerName" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_serial_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_serial_items_productId_serialNumber_key" ON "product_serial_items"("productId", "serialNumber");

-- CreateIndex
CREATE INDEX "product_serial_items_productId_status_idx" ON "product_serial_items"("productId", "status");

-- CreateIndex
CREATE INDEX "product_serial_items_siteId_status_idx" ON "product_serial_items"("siteId", "status");

-- AddForeignKey
ALTER TABLE "product_serial_items" ADD CONSTRAINT "product_serial_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serial_items" ADD CONSTRAINT "product_serial_items_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
