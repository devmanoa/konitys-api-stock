-- Timeline of every change on an Order
CREATE TABLE "order_audit_log" (
  "id"            TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "field"         TEXT,
  "oldValue"      TEXT,
  "newValue"      TEXT,
  "changedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedById"   TEXT,
  "changedByName" TEXT,
  CONSTRAINT "order_audit_log_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_audit_log"
  ADD CONSTRAINT "order_audit_log_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "order_audit_log_orderId_changedAt_idx"
  ON "order_audit_log"("orderId", "changedAt");
