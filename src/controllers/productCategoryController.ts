import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

/**
 * Catégorie principale d'un produit (Imprimante, PC, Écran, Câble, ...).
 * Le champ `codeReference` sert de préfixe pour générer automatiquement
 * les références internes des produits (voir docs "Règle de génération
 * des références produit").
 *
 * NB: distincte de PartCategory (localisation Tête/Pied/Socle) et de
 * PartType (nature Équipement/Protection/Visserie).
 */

// Normalise le code : majuscules, sans accents, sans espaces ni caractères
// spéciaux hors tiret. Vide -> string vide (le caller doit rejeter).
function normalizeCode(input: string): string {
  return input
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (combining marks)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '') // garder alnum + tiret uniquement
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Normalise le nom : trim + première lettre en majuscule.
function normalizeName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.productCategory.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, codeReference, description, isActive, displayOrder } = req.body;
    const normalizedName = normalizeName(name || '');
    const normalizedCode = normalizeCode(codeReference || '');
    if (!normalizedName) throw new AppError('Le nom est requis', 400);
    if (!normalizedCode) throw new AppError('Le code référence est requis', 400);
    if (normalizedCode.length > 12) {
      throw new AppError('Le code référence doit faire au plus 12 caractères', 400);
    }

    const dup = await prisma.productCategory.findFirst({
      where: {
        OR: [
          { name: { equals: normalizedName, mode: 'insensitive' } },
          { codeReference: { equals: normalizedCode, mode: 'insensitive' } },
        ],
      },
    });
    if (dup) {
      const which =
        dup.codeReference.toLowerCase() === normalizedCode.toLowerCase()
          ? `Le code « ${normalizedCode} » est déjà utilisé par « ${dup.name} »`
          : `Une catégorie nommée « ${dup.name} » existe déjà`;
      throw new AppError(which, 409);
    }

    const category = await prisma.productCategory.create({
      data: {
        name: normalizedName,
        codeReference: normalizedCode,
        description: description ?? null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        displayOrder: Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 0,
      },
    });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) throw new AppError('Catégorie non trouvée', 404);

    const { name, codeReference, description, isActive, displayOrder } = req.body;
    const data: {
      name?: string;
      codeReference?: string;
      description?: string | null;
      isActive?: boolean;
      displayOrder?: number;
    } = {};

    if (name !== undefined) {
      const normalized = normalizeName(name);
      if (!normalized) throw new AppError('Le nom est requis', 400);
      if (normalized.toLowerCase() !== existing.name.toLowerCase()) {
        const collision = await prisma.productCategory.findFirst({
          where: {
            id: { not: id },
            name: { equals: normalized, mode: 'insensitive' },
          },
        });
        if (collision) {
          throw new AppError(`Une catégorie nommée « ${collision.name} » existe déjà`, 409);
        }
      }
      data.name = normalized;
    }

    if (codeReference !== undefined) {
      const normalized = normalizeCode(codeReference);
      if (!normalized) throw new AppError('Le code référence est requis', 400);
      if (normalized.length > 12) {
        throw new AppError('Le code référence doit faire au plus 12 caractères', 400);
      }
      if (normalized !== existing.codeReference) {
        const collision = await prisma.productCategory.findFirst({
          where: {
            id: { not: id },
            codeReference: { equals: normalized, mode: 'insensitive' },
          },
        });
        if (collision) {
          throw new AppError(
            `Le code « ${normalized} » est déjà utilisé par « ${collision.name} »`,
            409,
          );
        }
      }
      data.codeReference = normalized;
    }

    if (description !== undefined) data.description = description;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (Number.isFinite(Number(displayOrder))) data.displayOrder = Number(displayOrder);

    const category = await prisma.productCategory.update({ where: { id }, data });
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) throw new AppError('Catégorie non trouvée', 404);
    // Pas de FK vers Product (Lot 2), on peut supprimer librement.
    await prisma.productCategory.delete({ where: { id } });
    res.json({ success: true, message: 'Catégorie supprimée' });
  } catch (error) {
    next(error);
  }
};
