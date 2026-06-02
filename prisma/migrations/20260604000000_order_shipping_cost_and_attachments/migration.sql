-- Optional total-shipping field on Order
ALTER TABLE "orders" ADD COLUMN "shippingCost" DECIMAL(10, 2);

-- Generic per-order attachments (invoice PDF, purchase order, palette photo, …)
CREATE TABLE "order_attachments" (
  "id"             TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "filename"       TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "mimeType"       TEXT,
  "size"           INTEGER,
  "uploadedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedById"   TEXT,
  "uploadedByName" TEXT,
  CONSTRAINT "order_attachments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_attachments"
  ADD CONSTRAINT "order_attachments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "order_attachments_orderId_uploadedAt_idx"
  ON "order_attachments"("orderId", "uploadedAt");
