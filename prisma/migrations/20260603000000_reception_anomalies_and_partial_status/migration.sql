-- Add PARTIAL status to OrderStatus enum (kept after PENDING for ordering)
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIAL' AFTER 'PENDING';

-- New AnomalyDecision enum
CREATE TYPE "AnomalyDecision" AS ENUM ('ACCEPTED', 'REFUSED');

-- Per-line reception anomalies (rayures, casse, etc.)
CREATE TABLE "order_item_anomalies" (
  "id"             TEXT NOT NULL,
  "orderItemId"    TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL,
  "decision"       "AnomalyDecision" NOT NULL,
  "comment"        TEXT NOT NULL,
  "photoUrls"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reportedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedById"   TEXT,
  "reportedByName" TEXT,
  CONSTRAINT "order_item_anomalies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_item_anomalies"
  ADD CONSTRAINT "order_item_anomalies_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "order_item_anomalies_orderItemId_idx" ON "order_item_anomalies"("orderItemId");

-- Flag on serial items that came in with an accepted anomaly
ALTER TABLE "product_serial_items"
  ADD COLUMN "hasAnomaly"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "anomalyComment" TEXT;
