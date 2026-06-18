-- Add public mobile share-link mechanism for inventories.
-- A link impersonates a Keycloak user (selected at creation time) so the
-- operator doesn't have to authenticate. The link is the credential.

CREATE TABLE "inventory_share_links" (
  "id"             TEXT NOT NULL,
  "inventoryId"    TEXT NOT NULL,
  "operatorUserId" TEXT NOT NULL,
  "operatorName"   TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "createdById"    TEXT,
  "createdByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"     TIMESTAMP(3),
  CONSTRAINT "inventory_share_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_share_links_inventoryId_idx" ON "inventory_share_links"("inventoryId");
CREATE INDEX "inventory_share_links_operatorUserId_idx" ON "inventory_share_links"("operatorUserId");

ALTER TABLE "inventory_share_links"
  ADD CONSTRAINT "inventory_share_links_inventoryId_fkey"
  FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_share_links"
  ADD CONSTRAINT "inventory_share_links_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trace which entries / unknowns were created via which share link, so
-- the public DELETE endpoint can refuse to remove someone else's saisie.
ALTER TABLE "inventory_entries" ADD COLUMN "shareLinkId" TEXT;
CREATE INDEX "inventory_entries_shareLinkId_idx" ON "inventory_entries"("shareLinkId");
ALTER TABLE "inventory_entries"
  ADD CONSTRAINT "inventory_entries_shareLinkId_fkey"
  FOREIGN KEY ("shareLinkId") REFERENCES "inventory_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_unknown_entries" ADD COLUMN "shareLinkId" TEXT;
CREATE INDEX "inventory_unknown_entries_shareLinkId_idx" ON "inventory_unknown_entries"("shareLinkId");
ALTER TABLE "inventory_unknown_entries"
  ADD CONSTRAINT "inventory_unknown_entries_shareLinkId_fkey"
  FOREIGN KEY ("shareLinkId") REFERENCES "inventory_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
