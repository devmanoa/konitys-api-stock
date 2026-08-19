import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { createSupplierContactSchema, updateSupplierContactSchema } from '../schemas/supplierContact';
import { asyncHandler } from '../utils/asyncHandler';

// Get all contacts for a supplier
export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = req.params.supplierId as string;

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    throw new AppError('Fournisseur non trouvé', 404);
  }

  const contacts = await prisma.supplierContact.findMany({
    where: { supplierId },
    orderBy: { lastName: 'asc' },
  });

  res.json({ success: true, data: contacts });
});

// Get a single contact
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = req.params.supplierId as string;
  const contactId = req.params.contactId as string;

  const contact = await prisma.supplierContact.findFirst({
    where: {
      id: contactId,
      supplierId,
    },
  });

  if (!contact) {
    throw new AppError('Contact non trouvé', 404);
  }

  res.json({ success: true, data: contact });
});

// Create a new contact
export const create = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = req.params.supplierId as string;

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    throw new AppError('Fournisseur non trouvé', 404);
  }

  // Validate input
  const validationResult = createSupplierContactSchema.safeParse(req.body);
  if (!validationResult.success) {
    const details = validationResult.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new AppError('Données invalides', 400, details);
  }

  const data = validationResult.data;

  const contact = await prisma.supplierContact.create({
    data: {
      ...data,
      email: data.email || null,
      phone: data.phone || null,
      position: data.position || null,
      description: data.description || null,
      supplierId,
    },
  });

  res.status(201).json({ success: true, data: contact });
});

// Update a contact
export const update = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = req.params.supplierId as string;
  const contactId = req.params.contactId as string;

  // Verify contact exists and belongs to supplier
  const existingContact = await prisma.supplierContact.findFirst({
    where: {
      id: contactId,
      supplierId,
    },
  });

  if (!existingContact) {
    throw new AppError('Contact non trouvé', 404);
  }

  // Validate input
  const validationResult = updateSupplierContactSchema.safeParse(req.body);
  if (!validationResult.success) {
    const details = validationResult.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new AppError('Données invalides', 400, details);
  }

  const data = validationResult.data;

  const contact = await prisma.supplierContact.update({
    where: { id: contactId },
    data: {
      ...data,
      email: data.email !== undefined ? (data.email || null) : undefined,
      phone: data.phone !== undefined ? (data.phone || null) : undefined,
      position: data.position !== undefined ? (data.position || null) : undefined,
      description: data.description !== undefined ? (data.description || null) : undefined,
    },
  });

  res.json({ success: true, data: contact });
});

// Delete a contact
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = req.params.supplierId as string;
  const contactId = req.params.contactId as string;

  // Verify contact exists and belongs to supplier
  const existingContact = await prisma.supplierContact.findFirst({
    where: {
      id: contactId,
      supplierId,
    },
  });

  if (!existingContact) {
    throw new AppError('Contact non trouvé', 404);
  }

  await prisma.supplierContact.delete({
    where: { id: contactId },
  });

  res.json({ success: true, message: 'Contact supprimé' });
});
