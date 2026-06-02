import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

// Create uploads directories if they don't exist
const uploadsDir = path.join(process.cwd(), 'uploads', 'products');
const filesDir = path.join(process.cwd(), 'uploads', 'files');
console.log('Upload directory:', uploadsDir);
console.log('Files directory:', filesDir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
}

// Configure multer for image upload
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${crypto.randomUUID()}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage: imageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez JPEG, PNG, GIF ou WebP'));
    }
  },
});

// Generic file upload (PDF, Office docs, archives, anything)
const fileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, filesDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${crypto.randomUUID()}${ext}`;
    cb(null, filename);
  },
});

const uploadFile = multer({
  storage: fileStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// POST /api/upload/image - Upload a product image
router.post('/image', upload.single('image'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;

    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        imageUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/upload/image/:filename - Delete an uploaded image
router.delete('/image/:filename', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filename = req.params.filename as string;
    const filePath = path.join(uploadsDir, filename);

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

// POST /api/upload/file - Upload a generic file (PDF, Office docs, archives, etc.)
router.post('/file', uploadFile.single('file'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });
    }

    const fileUrl = `/uploads/files/${req.file.filename}`;

    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        fileUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/upload/file/:filename - Delete an uploaded file
router.delete('/file/:filename', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filename = req.params.filename as string;
    const filePath = path.join(filesDir, filename);

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
