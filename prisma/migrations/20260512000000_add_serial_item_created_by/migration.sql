-- Track which user originally created a ProductSerialItem (typically via IN movement)
ALTER TABLE "product_serial_items"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "createdByName" TEXT;
