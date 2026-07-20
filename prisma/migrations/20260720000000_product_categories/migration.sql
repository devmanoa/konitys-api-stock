-- Catégorie principale d'un produit (Imprimante, PC, Écran, Câble, ...).
-- Sert de préfixe pour la génération automatique de la référence interne
-- (voir docs "Règle de génération des références produit").
-- Distincte de PartCategory (localisation) et PartType (nature).

CREATE TABLE "product_categories" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "codeReference" TEXT NOT NULL,
    "description"   TEXT,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "displayOrder"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_categories_name_key"          ON "product_categories"("name");
CREATE UNIQUE INDEX "product_categories_codeReference_key" ON "product_categories"("codeReference");
CREATE INDEX        "product_categories_active_order_idx"  ON "product_categories"("isActive", "displayOrder");
