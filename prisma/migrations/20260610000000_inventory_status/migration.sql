-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('DRAFT', 'CLOSED');

-- AlterTable
ALTER TABLE "inventories"
  ADD COLUMN "status" "InventoryStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedByName" TEXT,
  ADD COLUMN "correctionsApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "correctionsAppliedAt" TIMESTAMP(3);
