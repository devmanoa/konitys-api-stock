import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { recordAttachmentAdded, recordAttachmentRemoved } from '../services/orderAudit';
import { asyncHandler } from '../utils/asyncHandler';

// Attachments live under /uploads/order-attachments. Same disk volume as
// product images so Coolify already mounts it as persistent storage.
const uploadsDir = path.join(process.cwd(), 'uploads', 'order-attachments');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Allowlist mime->safe extension. On IGNORE l'extension du fichier fourni par
// l'attaquant (path.extname(file.originalname)) et on mappe strictement le
// mime declare a une extension serveur choisie ici. Sans ca, un attaquant
// authentifie pouvait uploader n'importe quoi (.exe, .bat, .phtml, .svg avec
// <script>...). Le mime user-fourni est de toute facon deja renvoye ensuite
// au frontend, donc si le mime n'est pas dans cette liste on refuse frontalement.
const ATTACHMENT_EXT: Record<string, string> = {
  // Images (photos de PL, scan bon de livraison)
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  // PDF (le plus frequent : facture / BL)
  'application/pdf': '.pdf',
  // Office (facture / devis)
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  // OpenDocument
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  // Archives (parfois un fournisseur envoie un .zip)
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  // Text
  'text/plain': '.txt',
  'text/csv': '.csv',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = ATTACHMENT_EXT[file.mimetype];
    if (!ext) return cb(new Error('Type de fichier non supporté'), '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ATTACHMENT_EXT[file.mimetype]) cb(null, true);
    else cb(new Error(`Type de fichier non supporté (${file.mimetype})`));
  },
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const attachments = await prisma.orderAttachment.findMany({
    where: { orderId },
    orderBy: { uploadedAt: 'desc' },
  });
  res.json({ success: true, data: attachments });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
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
  await recordAttachmentAdded(prisma, orderId, attachment.filename, {
    id: authUser?.id ?? null,
    name: authUser?.fullName || authUser?.username || null,
  });
  res.status(201).json({ success: true, data: attachment });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
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
  const authUser = (req as any).user as { id?: string; fullName?: string; username?: string } | undefined;
  await recordAttachmentRemoved(prisma, orderId, attachment.filename, {
    id: authUser?.id ?? null,
    name: authUser?.fullName || authUser?.username || null,
  });
  res.json({ success: true });
});
