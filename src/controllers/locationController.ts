import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { LocationQueryInput } from '../schemas/location';

const include = {
  site: true,
  parent: true,
  children: { orderBy: { position: 'asc' as const } },
};

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId } = ((req as any).parsedQuery || {}) as LocationQueryInput;
    const where: any = {};
    if (siteId) where.siteId = siteId;
    const locations = await prisma.location.findMany({
      where,
      include,
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, parentId, name, position } = req.body;
    // If parentId is provided, its siteId wins — children always belong to the
    // same site as their parent. This keeps the tree consistent in the UI.
    let effectiveSiteId: string | null = siteId ?? null;
    if (parentId) {
      const parent = await prisma.location.findUnique({ where: { id: parentId } });
      if (!parent) throw new AppError('Emplacement parent introuvable', 404);
      effectiveSiteId = parent.siteId ?? null;
    }
    const location = await prisma.location.create({
      data: {
        siteId: effectiveSiteId,
        parentId: parentId ?? null,
        name: name.trim(),
        position: position ?? 0,
      },
      include,
    });
    res.status(201).json({ success: true, data: location });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('Un emplacement avec ce nom existe déjà à ce niveau', 400));
    }
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const data: any = {};
    if (typeof req.body.name === 'string') data.name = req.body.name.trim();
    if (typeof req.body.position === 'number') data.position = req.body.position;
    const location = await prisma.location.update({ where: { id }, data, include });
    res.json({ success: true, data: location });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('Un emplacement avec ce nom existe déjà à ce niveau', 400));
    }
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    // Note: cascading deletes wipe children. Products pointing at this
    // location have their locationId set to NULL by the FK.
    await prisma.location.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
