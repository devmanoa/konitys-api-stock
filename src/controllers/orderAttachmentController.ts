import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

// Attachments live under /uploads/order-attachments. Same disk volume as
// product images so Coolify already mounts it as persistent storage.
const uploadsDir = path.join(process.cwd(), 'uploads', 'order-attachments');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// "Tous fichiers acceptés" per the product owner — no mime filter, just a size cap.
// 10 MB keeps a single PDF/photo/invoice while preventing dump abuse.
export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id as string;
    const attachments = await prisma.orderAttachment.findMany({
      where: { orderId },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ success: true, data: attachments });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id as string;
    if (!req.file) {
      throw new AppError('Aucun fichier uploadé', 400);
    }
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) {
      // Clean up the dangling file before bailing out.
      try { fs.unlinkSync(path.join(uploadsDir, req.file.filename)); } catch {}
      throw new AppError('Commande non trouvée', 404);
    }
    const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
    const attachment = await prisma.orderAttachment.create({
      data: {
        orderId,
        filename: req.file.originalname,
        url: `/uploads/order-attachments/${req.file.filename}`,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedById: authUser?.id ?? null,
        uploadedByName: authUser?.fullName || authUser?.username || null,
      },
    });
    res.status(201).json({ success: true, data: attachment });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;
    const attachment = await prisma.orderAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.orderId !== orderId) {
      throw new AppError('Pièce jointe non trouvée', 404);
    }
    // Best-effort disk cleanup (DB row removal is the source of truth)
    const filename = path.basename(attachment.url);
    const filePath = path.join(uploadsDir, filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore — orphan files on disk are tolerable; we don't want to block the DELETE
    }
    await prisma.orderAttachment.delete({ where: { id: attachmentId } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
