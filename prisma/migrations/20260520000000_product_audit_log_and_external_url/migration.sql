-- Free-form external URL on the product (e.g. an Amazon page)
ALTER TABLE "products" ADD COLUMN "externalUrl" TEXT;

-- Timeline of every field-level change on a product
CREATE TABLE "product_audit_log" (
  "id"            TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "field"         TEXT,
  "oldValue"      TEXT,
  "newValue"      TEXT,
  "changedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedById"   TEXT,
  "changedByName" TEXT,
  CONSTRAINT "product_audit_log_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_audit_log"
  ADD CONSTRAINT "product_audit_log_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "product_audit_log_productId_changedAt_idx"
  ON "product_audit_log"("productId", "changedAt");
