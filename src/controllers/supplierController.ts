import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { publishCrudEvent } from '../services/rabbitmq';
import { lookupBySiret, searchByText } from '../services/companyLookup';
import { asyncHandler } from '../utils/asyncHandler';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search, assemblyTypeId } = (req as any).parsedQuery || req.query;

  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { contact: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Filter suppliers that have products linked to a specific assembly type
  if (assemblyTypeId) {
    where.productSuppliers = {
      some: {
        product: {
          assemblyTypes: {
            some: { assemblyTypeId: assemblyTypeId as string },
          },
        },
      },
    };
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      include: {
        _count: {
          select: { productSuppliers: true, orders: true },
        },
      },
      orderBy: { name: 'asc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.supplier.count({ where }),
  ]);

  res.json({
    success: true,
    data: suppliers,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      productSuppliers: {
        include: {
          product: {
            include: {
              assembly: true,
              assemblyTypes: { include: { assemblyType: true } },
            },
          },
        },
      },
      orders: {
        include: {
          items: {
            include: {
              product: true,
              anomalies: { orderBy: { reportedAt: 'desc' } },
            },
          },
          destinationSite: true,
        },
        orderBy: { orderDate: 'desc' },
      },
      contacts: {
        orderBy: { lastName: 'asc' },
      },
    },
  });

  if (!supplier) {
    throw new AppError('Fournisseur non trouvé', 404);
  }

  res.json({ success: true, data: supplier });
});

/**
 * GET /suppliers/:id/reception-anomalies
 * Flat list of every anomaly reported across all of this supplier's orders.
 * Used by the supplier detail page to surface the supplier's reliability.
 */
export const getReceptionAnomalies = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const anomalies = await prisma.orderItemAnomaly.findMany({
    where: { orderItem: { order: { supplierId: id } } },
    orderBy: { reportedAt: 'desc' },
    include: {
      orderItem: {
        include: {
          order: { select: { id: true, orderNumber: true, orderDate: true } },
          product: { select: { id: true, reference: true, description: true, imageUrl: true } },
        },
      },
    },
  });
  res.json({ success: true, data: anomalies });
});

/**
 * GET /suppliers/company-search?q=...
 * Public, gateway-style — proxies recherche-entreprises.api.gouv.fr so the
 * client doesn't have to deal with CORS or rate-limit attribution.
 */
export const companySearch = asyncHandler(async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const hits = await searchByText(q, 5);
  res.json({ success: true, data: hits });
});

/**
 * POST /suppliers/:id/refresh-company-info
 * Re-fetches and persists the company data using the supplier's stored SIRET
 * (or the one provided in the body if no SIRET is set yet).
 */
export const refreshCompanyInfo = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new AppError('Fournisseur non trouvé', 404);
  const siret = (req.body?.siret as string) || supplier.siret;
  if (!siret) {
    throw new AppError('SIREN/SIRET requis pour la recherche', 400);
  }
  const info = await lookupBySiret(siret);
  if (!info) {
    throw new AppError('Aucune entreprise trouvée pour ce numéro', 404);
  }
  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      siret: info.siret ?? supplier.siret,
      siren: info.siren ?? supplier.siren,
      legalName: info.legalName ?? supplier.legalName,
      legalStatus: info.legalStatus ?? supplier.legalStatus,
      naf: info.naf ?? supplier.naf,
      nafLabel: info.nafLabel ?? supplier.nafLabel,
      creationYear: info.creationYear ?? supplier.creationYear,
      // Don't overwrite the user-edited contact address unless it was empty
      address: supplier.address || info.address || null,
      postalCode: supplier.postalCode || info.postalCode || null,
      city: supplier.city || info.city || null,
      companyInfoUpdatedAt: new Date(),
    },
  });
  res.json({ success: true, data: updated });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const supplier = await prisma.supplier.create({
    data: req.body,
  });

  publishCrudEvent('suppliers', 'inserted', supplier, (req as any).user);

  res.status(201).json({ success: true, data: supplier });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const previous = await prisma.supplier.findUnique({ where: { id } });

  const supplier = await prisma.supplier.update({
    where: { id },
    data: req.body,
  });

  publishCrudEvent('suppliers', 'updated', supplier, (req as any).user);

  // Fire-and-forget company info refresh when the SIRET was just added or
  // changed. Don't block the response — if the API is slow or down, the
  // user's edit still succeeds and they can hit the manual refresh later.
  const newSiret = (req.body?.siret as string) || null;
  const prevSiret = previous?.siret || null;
  if (newSiret && newSiret !== prevSiret) {
    lookupBySiret(newSiret)
      .then(async (info) => {
        if (!info) return;
        // Re-read the supplier in case the user kept editing while we were
        // waiting on the external API — don't clobber their typed address.
        const current = await prisma.supplier.findUnique({ where: { id } });
        await prisma.supplier.update({
          where: { id },
          data: {
            siret: info.siret ?? newSiret,
            siren: info.siren ?? null,
            legalName: info.legalName ?? null,
            legalStatus: info.legalStatus ?? null,
            naf: info.naf ?? null,
            nafLabel: info.nafLabel ?? null,
            creationYear: info.creationYear ?? null,
            // Fill the postal address only if the user hasn't entered one.
            address: current?.address || info.address || null,
            postalCode: current?.postalCode || info.postalCode || null,
            city: current?.city || info.city || null,
            companyInfoUpdatedAt: new Date(),
          },
        });
      })
      .catch(() => {
        // best-effort — ignore failures
      });
  }

  res.json({ success: true, data: supplier });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  await prisma.supplier.delete({ where: { id } });

  publishCrudEvent('suppliers', 'deleted', { id }, (req as any).user);

  res.json({ success: true, message: 'Fournisseur supprimé' });
});
