import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

const uploadsDir = path.join(process.cwd(), 'uploads', 'products');
const filesDir = path.join(process.cwd(), 'uploads', 'files');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

// Allowlist mime->safe extension so we never propagate user-controlled
// extensions to disk (defends against xss.html, .svg, .phtml, double-ext etc.).
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const FILE_EXT: Record<string, string> = {
  // PDFs
  'application/pdf': '.pdf',
  // Office (legacy + OOXML)
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  // OpenDocument
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  // Archives
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  // Text
  'text/plain': '.txt',
  'text/csv': '.csv',
};

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) return cb(new Error('Type d\'image non supporté'), '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Type non supporté. Utilisez JPEG, PNG, GIF ou WebP'));
  },
});

const fileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, filesDir),
  filename: (_req, file, cb) => {
    const ext = FILE_EXT[file.mimetype];
    if (!ext) return cb(new Error('Type de fichier non supporté'), '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploadFile = multer({
  storage: fileStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Block any executable / web mime that could be served as scripts.
    if (FILE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Type de fichier non supporté'));
  },
});

/**
 * Resolve a filename against a base directory and refuse anything that
 * escapes it (path traversal `../`, absolute paths, encoded `%2F`).
 */
function safeJoin(baseDir: string, filename: string): string | null {
  const safe = path.basename(filename);
  if (!safe || safe.includes('..') || safe.includes('\0')) return null;
  const resolved = path.resolve(baseDir, safe);
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) return null;
  return resolved;
}

// POST /api/upload/image
router.post('/image', upload.single('image'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });
    }
    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        imageUrl: `/uploads/products/${req.file.filename}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/upload/image/:filename
router.delete('/image/:filename', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filePath = safeJoin(uploadsDir, req.params.filename as string);
    if (!filePath) return res.status(400).json({ success: false, error: 'Nom de fichier invalide' });
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'Image supprimée' });
    } else {
      res.status(404).json({ success: false, error: 'Image non trouvée' });
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/upload/file
router.post('/file', uploadFile.single('file'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });
    }
    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        fileUrl: `/uploads/files/${req.file.filename}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/upload/file/:filename
router.delete('/file/:filename', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filePath = safeJoin(filesDir, req.params.filename as string);
    if (!filePath) return res.status(400).json({ success: false, error: 'Nom de fichier invalide' });
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'Fichier supprimé' });
    } else {
      res.status(404).json({ success: false, error: 'Fichier non trouvé' });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
