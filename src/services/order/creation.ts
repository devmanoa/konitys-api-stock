import prisma from '../../config/database';
import { orderInclude } from './orderInclude';
import { recordCreated } from './audit';
import { AuthUser } from './types';

// Creation d'une commande : generation atomique du numero CMD-YYYY-NNNN
// puis creation de l'entete + lignes + entree d'audit dans la meme transaction.
// Bloc $transaction deplace tel quel depuis orderController.create.
// NB: headerData vient du spread de req.body (deja valide par Zod en amont),
// on conserve le typage any du controller d'origine pour le spread Prisma.
export async function createOrder(
  headerData: any,
  items: { productId: string; quantity: number; unitPrice?: number }[],
  authUser: AuthUser | undefined,
) {
  const createdBy = authUser?.fullName || authUser?.username || null;

  const order = await prisma.$transaction(async (tx) => {
    // Generate orderNumber: CMD-YYYY-NNNN
    const year = new Date().getFullYear();
    const prefix = `CMD-${year}-`;

    const lastOrder = await tx.order.findFirst({
      where: { orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    let nextSeq = 1;
    if (lastOrder?.orderNumber) {
      const parts = lastOrder.orderNumber.split('-');
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextSeq = lastSeq + 1;
      }
    }

    const orderNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

    const created = await tx.order.create({
      data: {
        ...headerData,
        orderNumber,
        createdBy,
        items: {
          create: items.map((item: { productId: string; quantity: number; unitPrice?: number }) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? null,
          })),
        },
      },
      include: orderInclude,
    });

    // Audit: single 'created' entry — we don't list every field-level value
    // because the user just typed them and the diff vs nothing isn't useful.
    await recordCreated(tx, created.id, {
      id: authUser?.id ?? null,
      name: createdBy,
    });

    return created;
  });

  return order;
}
