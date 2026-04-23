import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sections = await prisma.borneSection.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: sections });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const section = await prisma.borneSection.findUnique({ where: { id } });
    if (!section) throw new AppError('Section non trouvée', 404);
    res.json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body;
    const section = await prisma.borneSection.create({ data: { name } });
    publishCrudEvent('borne_sections', 'inserted', section as any, (req as any).user);
    res.status(201).json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name } = req.body;
    const existing = await prisma.borneSection.findUnique({ where: { id } });
    if (!existing) throw new AppError('Section non trouvée', 404);
    const section = await prisma.borneSection.update({ where: { id }, data: { name } });
    publishCrudEvent('borne_sections', 'updated', section as any, (req as any).user);
    res.json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.borneSection.findUnique({ where: { id } });
    if (!existing) throw new AppError('Section non trouvée', 404);
    await prisma.borneSection.delete({ where: { id } });
    publishCrudEvent('borne_sections', 'deleted', { id }, (req as any).user);
    res.json({ success: true, message: 'Section supprimée' });
  } catch (error) {
    next(error);
  }
};
