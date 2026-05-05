import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

// Normalize a category name: trim whitespace, then first letter uppercase + rest lowercase.
// Empty / null input returns empty string (caller should reject before calling).
function normalizeName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

// Get all part categories
export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.partCategory.findMany({
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

// Create a part category
export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description } = req.body;
    const normalized = normalizeName(name || '');
    if (!normalized) throw new AppError('Le nom est requis', 400);

    // Case-insensitive duplicate check: if one already exists with the same
    // lowercased name, return it instead of creating a new row. This is
    // friendlier than letting the unique-on-LOWER(name) index throw.
    const existing = await prisma.partCategory.findFirst({
      where: { name: { equals: normalized, mode: 'insensitive' } },
    });
    if (existing) {
      return res.status(200).json({ success: true, data: existing, deduped: true });
    }

    const category = await prisma.partCategory.create({
      data: {
        name: normalized,
        description,
      },
    });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

// Update a part category
export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, description } = req.body;

    const existing = await prisma.partCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Catégorie non trouvée', 404);
    }

    const updateData: any = {};
    if (name !== undefined) {
      const normalized = normalizeName(name);
      if (!normalized) throw new AppError('Le nom est requis', 400);

      // If renaming would collide with another category (case-insensitively), refuse.
      const collision = await prisma.partCategory.findFirst({
        where: {
          id: { not: id },
          name: { equals: normalized, mode: 'insensitive' },
        },
      });
      if (collision) {
        throw new AppError(`Une catégorie nommée « ${collision.name} » existe déjà`, 409);
      }
      updateData.name = normalized;
    }
    if (description !== undefined) updateData.description = description;

    const category = await prisma.partCategory.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

// Delete a part category
export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.partCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Catégorie non trouvée', 404);
    }

    await prisma.partCategory.delete({ where: { id } });

    res.json({ success: true, message: 'Catégorie supprimée' });
  } catch (error) {
    next(error);
  }
};
