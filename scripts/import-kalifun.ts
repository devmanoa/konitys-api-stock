/**
 * Import the "Kalifun" assembly type and its nomenclature.
 *
 * Source: nomenclature_kalifun.xlsx (delivered by user 2026-06-16).
 * Idempotent: re-running updates existing rows in place instead of duplicating.
 *
 * Run from server/: `npx tsx scripts/import-kalifun.ts`
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ASSEMBLY_TYPE_NAME = 'Kalifun';

interface Row {
  designation: string;
  reference: string;
  quantity: number;
  unitPriceHT: number;
  supplier: string;
  productUrl: string;
  comment: string;
}

// Hard-coded from the spreadsheet so the import is reproducible without a
// runtime dependency on the xlsx file. If the BOM changes, update this list
// and re-run the script.
const ROWS: Row[] = [
  { designation: "Écran tactile capacitif 10,1'' DSI pour Raspberry Pi 5", reference: 'WV-300',     quantity: 1, unitPriceHT: 51.25,  supplier: 'Kubii.com',  productUrl: 'https://www.kubii.com/fr/ecrans-supports/4682-ecran-tactile-capacitif-101-dsi-pour-raspberry-pi-5-3272496323285.html', comment: '' },
  { designation: 'Raspberry Pi 5 8 Go',                                     reference: 'B0CRMQCYXH', quantity: 1, unitPriceHT: 155,    supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B0CRMQCYXH', comment: '' },
  { designation: 'RAZER KYO PRO',                                           reference: 'B08PKBZ428', quantity: 1, unitPriceHT: 190,    supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B08PKBZ428', comment: '' },
  { designation: 'AC/DC Adapter 220/12V 5A',                                reference: 'B0B633X9LP', quantity: 1, unitPriceHT: 25,     supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B0B633X9LP', comment: '' },
  { designation: 'Convertisseur 12V/5V',                                    reference: 'B09B7XZYJQ', quantity: 1, unitPriceHT: 8,      supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B09B7XZYJQ', comment: '' },
  { designation: '5630 Double rangée LED',                                  reference: 'DRLLed',     quantity: 1, unitPriceHT: 6,      supplier: 'Aliexpress', productUrl: 'https://fr.aliexpress.com/item/32967571402.html', comment: '' },
  { designation: 'Carte de control PWM',                                    reference: 'B07TVH42W6', quantity: 1, unitPriceHT: 1.2,    supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B07TVH42W6', comment: '' },
  { designation: 'Serrure Triangle',                                        reference: 'B09DPTYY8L', quantity: 1, unitPriceHT: 7,      supplier: 'Amazon',     productUrl: '',                                              comment: 'pas définitif' },
  { designation: 'Imprimante Canon selphy 1500',                            reference: 'B0DZDXF47Q', quantity: 1, unitPriceHT: 108,    supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B0DZDXF47Q', comment: '' },
  { designation: 'Cable USB C vers USB A',                                  reference: 'B07PPY9N62', quantity: 1, unitPriceHT: 4.34,   supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B07PPY9N62', comment: '' },
  { designation: 'Trepied Gravity',                                         reference: 'SP5111B',    quantity: 1, unitPriceHT: 29.6,   supplier: 'Sonovente',  productUrl: 'https://www.sonovente.com/gravity-sp-5111-b-p84952.html', comment: '' },
  { designation: 'Prise Double USB panneau',                                reference: 'B0CQLPL1TP', quantity: 1, unitPriceHT: 14.16,  supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B0CQLPL1TP', comment: '' },
  { designation: 'Cable USB Mâle vers Mâle',                                reference: 'B0CT7N9BHN', quantity: 2, unitPriceHT: 6.4,    supplier: 'Amazon',     productUrl: 'https://www.amazon.fr/dp/B0CT7N9BHN', comment: '' },
  { designation: "Embase support d'enceinte",                               reference: 'ZQUISC235',  quantity: 1, unitPriceHT: 12.55,  supplier: 'Sonovente',  productUrl: 'https://www.sonovente.com/quiklok-sc235-adaptateur-35mm-pour-enceinte-p103898.html', comment: '' },
];

async function main() {
  console.log(`Import "${ASSEMBLY_TYPE_NAME}" — ${ROWS.length} produits\n`);

  const assemblyType = await prisma.assemblyType.upsert({
    where: { name: ASSEMBLY_TYPE_NAME },
    update: {},
    create: {
      name: ASSEMBLY_TYPE_NAME,
      description: 'Borne Kalifun — nomenclature de production',
    },
  });
  console.log(`✓ AssemblyType "${assemblyType.name}" (${assemblyType.id})`);

  const supplierCache = new Map<string, string>();
  let created = 0;
  let updated = 0;

  for (const row of ROWS) {
    const supplier = await prisma.supplier.upsert({
      where: { name: row.supplier },
      update: {},
      create: { name: row.supplier },
    });
    supplierCache.set(row.supplier, supplier.id);

    const existing = await prisma.product.findUnique({
      where: { reference: row.reference },
    });

    const product = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: {
            description: row.designation,
            comment: row.comment || existing.comment,
          },
        })
      : await prisma.product.create({
          data: {
            reference: row.reference,
            description: row.designation,
            comment: row.comment || null,
          },
        });

    if (existing) updated++;
    else created++;

    await prisma.productSupplier.upsert({
      where: {
        productId_supplierId: {
          productId: product.id,
          supplierId: supplier.id,
        },
      },
      update: {
        supplierRef: row.reference,
        unitPrice: row.unitPriceHT,
        productUrl: row.productUrl || null,
        isPrimary: true,
        priceUpdatedAt: new Date(),
      },
      create: {
        productId: product.id,
        supplierId: supplier.id,
        supplierRef: row.reference,
        unitPrice: row.unitPriceHT,
        productUrl: row.productUrl || null,
        isPrimary: true,
        priceUpdatedAt: new Date(),
      },
    });

    await prisma.assemblyTypeItem.upsert({
      where: {
        assemblyTypeId_productId: {
          assemblyTypeId: assemblyType.id,
          productId: product.id,
        },
      },
      update: { quantity: row.quantity },
      create: {
        assemblyTypeId: assemblyType.id,
        productId: product.id,
        quantity: row.quantity,
      },
    });

    console.log(`  ${existing ? '↻' : '+'} ${row.reference}  ${row.designation}  (qté ${row.quantity}, ${row.unitPriceHT} € HT, ${row.supplier})`);
  }

  console.log(`\nRésultat: ${created} produit(s) créé(s), ${updated} mis à jour.`);
  console.log(`Type d'assemblage: ${assemblyType.id}`);
  console.log(`\nNote: les visuels (images produits) doivent être ajoutés manuellement via l'UI.`);
}

main()
  .catch((err) => {
    console.error('Erreur:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
