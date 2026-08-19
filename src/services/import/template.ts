import * as XLSX from 'xlsx';

// Construit le classeur modele d'import et retourne son buffer xlsx
export function buildTemplateWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  // Products template
  const productsData = [
    ['Référence produit', 'Description', 'Qté 1 borne', 'Risque appro', 'Emplacement', 'Commentaire'],
    ['PROD-001', 'Description du produit', 1, 'Moyen', 'A1', 'Notes...'],
  ];
  const productsSheet = XLSX.utils.aoa_to_sheet(productsData);
  XLSX.utils.book_append_sheet(workbook, productsSheet, 'PRODUITS');

  // Suppliers template
  const suppliersData = [
    ['Produit', 'Fournisseur', 'Principal ?', 'PU HT', 'Délai', 'Frais livraison', 'Ref fournisseur', 'URL'],
    ['PROD-001', 'Fournisseur A', true, 10.50, '2-3 jours', 5.00, 'FA-001', 'https://...'],
  ];
  const suppliersSheet = XLSX.utils.aoa_to_sheet(suppliersData);
  XLSX.utils.book_append_sheet(workbook, suppliersSheet, 'REF FOURNISSEURS');

  // Stock Initial template
  const stockData = [
    ['Référence produit', 'Siège : neuf', 'Siège : occasion', 'Entrepôt : neuf', 'Entrepôt : occasion'],
    ['PROD-001', 10, 2, 5, 0],
  ];
  const stockSheet = XLSX.utils.aoa_to_sheet(stockData);
  XLSX.utils.book_append_sheet(workbook, stockSheet, 'STOCK INITIAL');

  // Movements template
  const movementsData = [
    ['Produit', 'Mouvement', 'Source', 'Cible', 'Qté', 'Date', 'Opérateur', 'Commentaire'],
    ['PROD-001', 'Déplacement', 'Siège : neuf', 'Entrepôt : neuf', 5, new Date(), 'John', 'Transfert mensuel'],
  ];
  const movementsSheet = XLSX.utils.aoa_to_sheet(movementsData);
  XLSX.utils.book_append_sheet(workbook, movementsSheet, 'MVT CLASSIK');

  // Orders template
  const ordersData = [
    ['Produit', 'Fournisseur', 'Qté', 'État commande', 'Destination', 'Date commande', 'Date prévue', 'Qté reçue', 'Responsable', 'Commentaire'],
    ['PROD-001', 'Fournisseur A', 10, 'En cours', 'Siège : neuf', new Date(), new Date(), null, 'John', 'Commande urgente'],
  ];
  const ordersSheet = XLSX.utils.aoa_to_sheet(ordersData);
  XLSX.utils.book_append_sheet(workbook, ordersSheet, 'COMMANDES CLASSIK');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
