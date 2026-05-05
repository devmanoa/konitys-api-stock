-- ProductSerialItem.customerName is repurposed: when an item leaves stock,
-- it gets installed on a borne, not delivered to a customer. Rename the
-- column so the model reflects the actual semantics. No data to preserve
-- (no customer names have been entered so far).
ALTER TABLE "product_serial_items" RENAME COLUMN "customerName" TO "borneNumber";
