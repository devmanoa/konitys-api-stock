-- Fallback priceUpdatedAt to createdAt for existing ProductSupplier rows that
-- have a price but no recorded update date (rows created before the field
-- was wired up, or imported without a price date).
UPDATE "product_suppliers"
SET "priceUpdatedAt" = "createdAt"
WHERE "unitPrice" IS NOT NULL
  AND "priceUpdatedAt" IS NULL;
