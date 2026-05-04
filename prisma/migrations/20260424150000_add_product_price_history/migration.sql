-- CreateTable
CREATE TABLE "product_price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    "changedByName" TEXT,

    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_price_history_productId_changedAt_idx" ON "product_price_history"("productId", "changedAt");

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: seed history with current ProductSupplier prices
-- For each ProductSupplier that has a unitPrice today, create a history row
-- with priceUpdatedAt (or createdAt as fallback) and the supplier's current name
INSERT INTO "product_price_history" ("id", "productId", "supplierId", "supplierName", "unitPrice", "changedAt")
SELECT
  gen_random_uuid(),
  ps."productId",
  ps."supplierId",
  s."name",
  ps."unitPrice",
  COALESCE(ps."priceUpdatedAt", ps."createdAt")
FROM "product_suppliers" ps
JOIN "suppliers" s ON s."id" = ps."supplierId"
WHERE ps."unitPrice" IS NOT NULL;
