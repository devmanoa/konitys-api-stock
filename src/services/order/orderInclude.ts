// Include Prisma commun a toutes les lectures de commandes
// (deplace tel quel depuis orderController).

export const orderInclude = {
  supplier: true,
  destinationSite: true,
  items: {
    include: {
      product: true,
      anomalies: { orderBy: { reportedAt: 'desc' as const } },
    },
  },
  attachments: { orderBy: { uploadedAt: 'desc' as const } },
};
