import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { orderInclude } from './orderInclude';
import { diffOrderScalars, recordFieldChanges, recordStatusChange } from './audit';
import { AuthUser } from './types';

// Mise a jour d'une commande : diff des champs scalaires suivis + trace
// dediee pour les transitions de statut. Bloc $transaction deplace tel quel
// depuis orderController.update (req.body devient le parametre body).
export async function updateOrder(
  id: string,
  body: any,
  authUser: AuthUser | undefined,
) {
  const who = {
    id: authUser?.id ?? null,
    name: authUser?.fullName || authUser?.username || null,
  };

  // Snapshot the order before the update so we can diff and emit audit rows.
  const previous = await prisma.order.findUnique({ where: { id } });
  if (!previous) throw new AppError('Commande non trouvée', 404);

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: body,
      include: orderInclude,
    });

    // Diff: tracked scalar fields
    const diffs = diffOrderScalars(previous as any, body);
    await recordFieldChanges(tx, id, diffs, who);

    // Status transitions get their own dedicated audit row so the timeline
    // can highlight them with a distinct icon/color.
    if (body.status && body.status !== previous.status) {
      await recordStatusChange(tx, id, previous.status, body.status, who);
    }

    return updated;
  });

  return order;
}

// Suppression d'une commande : refusee si la commande est terminee ou si
// au moins un article a deja ete receptionne.
export async function deleteOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }

  if (order.status === 'COMPLETED') {
    throw new AppError('Impossible de supprimer une commande terminée', 400);
  }

  const hasReceivedItems = order.items.some((i) => i.receivedQty !== null && i.receivedQty > 0);
  if (hasReceivedItems) {
    throw new AppError('Impossible de supprimer une commande avec des articles déjà réceptionnés', 400);
  }

  await prisma.order.delete({ where: { id } });
}
