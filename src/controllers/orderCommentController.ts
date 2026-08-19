import { Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';
import { asyncHandler } from '../utils/asyncHandler';

export const getAll = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { page = 1, limit = 50 } = (req as any).parsedQuery || {};

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }

  const [comments, total] = await Promise.all([
    prisma.orderComment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.orderComment.count({ where: { orderId } }),
  ]);

  res.json({
    success: true,
    data: comments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { content } = req.body;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }

  const comment = await prisma.orderComment.create({
    data: {
      orderId,
      content,
      authorId: req.user.id,
      authorUsername: req.user.username,
      authorName: req.user.fullName || req.user.username,
    },
  });

  res.status(201).json({ success: true, data: comment });
});

export const update = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id as string;
  const commentId = req.params.commentId as string;
  const { content } = req.body;

  const existing = await prisma.orderComment.findFirst({
    where: { id: commentId, orderId },
  });

  if (!existing) {
    throw new AppError('Commentaire non trouvé', 404);
  }

  if (existing.authorId !== req.user.id) {
    throw new AppError('Vous ne pouvez modifier que vos propres commentaires', 403);
  }

  const updated = await prisma.orderComment.update({
    where: { id: commentId },
    data: { content },
  });

  res.json({ success: true, data: updated });
});

export const remove = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id as string;
  const commentId = req.params.commentId as string;

  const existing = await prisma.orderComment.findFirst({
    where: { id: commentId, orderId },
  });

  if (!existing) {
    throw new AppError('Commentaire non trouvé', 404);
  }

  const isAdmin = req.user.roles?.includes('admin');
  if (existing.authorId !== req.user.id && !isAdmin) {
    throw new AppError('Vous ne pouvez supprimer que vos propres commentaires', 403);
  }

  await prisma.orderComment.delete({ where: { id: commentId } });

  res.json({ success: true, message: 'Commentaire supprimé' });
});
