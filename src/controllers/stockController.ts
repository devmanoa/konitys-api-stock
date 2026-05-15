import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stocks = await prisma.stock.findMany({
      include: {
        product: {
          include: {
            assemblyTypes: { include: { assemblyType: true } },
            assembly: {
              include: {
                assemblyTypes: {
                  include: { assemblyType: true },
                },
              },
            },
          },
        },
        site: true,
      },
      orderBy: [
        { product: { reference: 'asc' } },
        { site: { name: 'asc' } },
      ],
    });

    res.json({ success: true, data: stocks });
  } catch (error) {
    next(error);
  }
};

// Reconstruct stock at a past date by replaying every StockMovement that
// happened *after* the requested date in reverse on top of the current stock.
export const getSnapshot = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dateParam = req.query.date as string | undefined;
    if (!dateParam) {
      return res.status(400).json({ success: false, error: 'Paramètre `date` requis (YYYY-MM-DD)' });
    }
    // Expect strict YYYY-MM-DD; build the cutoff at end-of-day in UTC so the
    // result is independent of the server's local timezone (Coolify
    // containers may be UTC, Europe/Paris, etc.).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!m) {
      return res.status(400).json({ success: false, error: 'Date invalide (format attendu : YYYY-MM-DD)' });
    }
    const [, y, mo, d] = m;
    const cutoff = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999));
    if (isNaN(cutoff.getTime())) {
      return res.status(400).json({ success: false, error: 'Date invalide' });
    }

    const [currentStocks, futureMovements] = await Promise.all([
      prisma.stock.findMany({
        include: {
          product: {
            include: {
              assemblyTypes: { include: { assemblyType: true } },
              assembly: {
                include: {
                  assemblyTypes: {
                    include: { assemblyType: true },
                  },
                },
              },
            },
          },
          site: true,
        },
        orderBy: [
          { product: { reference: 'asc' } },
          { site: { name: 'asc' } },
        ],
      }),
      prisma.stockMovement.findMany({
        where: { movementDate: { gt: cutoff } },
        select: {
          productId: true,
          type: true,
          sourceSiteId: true,
          targetSiteId: true,
          quantity: true,
          condition: true,
        },
      }),
    ]);

    // Build a map keyed by `${productId}|${siteId}` so we can look up the
    // existing Stock row and amend its quantities. We also have to add rows
    // for (product, site) pairs that have a non-zero past stock but zero
    // current stock — those don't appear in `currentStocks` at all.
    type SnapshotRow = (typeof currentStocks)[number] & { quantityNew: number; quantityUsed: number };
    const map = new Map<string, SnapshotRow>();
    for (const s of currentStocks) {
      map.set(`${s.productId}|${s.siteId}`, { ...s });
    }

    const productCache = new Map<string, (typeof currentStocks)[number]['product']>();
    const siteCache = new Map<string, (typeof currentStocks)[number]['site']>();
    for (const s of currentStocks) {
      productCache.set(s.productId, s.product);
      siteCache.set(s.siteId, s.site);
    }

    const ensureRow = async (productId: string, siteId: string): Promise<SnapshotRow | null> => {
      const key = `${productId}|${siteId}`;
      const existing = map.get(key);
      if (existing) return existing;

      // Need to synthesize a stock row for a (product, site) that no longer
      // has any stock today. Lazy-load the product and site once.
      let product = productCache.get(productId);
      if (!product) {
        const p = await prisma.product.findUnique({
          where: { id: productId },
          include: {
            assemblyTypes: { include: { assemblyType: true } },
            assembly: {
              include: {
                assemblyTypes: {
                  include: { assemblyType: true },
                },
              },
            },
          },
        });
        if (!p) return null;
        product = p;
        productCache.set(productId, p);
      }
      let site = siteCache.get(siteId);
      if (!site) {
        const s = await prisma.site.findUnique({ where: { id: siteId } });
        if (!s) return null;
        site = s;
        siteCache.set(siteId, s);
      }
      const synthesized = {
        id: `synth-${productId}-${siteId}`,
        productId,
        siteId,
        product,
        site,
        quantityNew: 0,
        quantityUsed: 0,
        updatedAt: cutoff,
      } as unknown as SnapshotRow;
      map.set(key, synthesized);
      return synthesized;
    };

    // Replay each future movement in reverse: undo its effect on stock.
    for (const m of futureMovements) {
      const field = m.condition === 'NEW' ? 'quantityNew' : 'quantityUsed';

      // A movement that took stock OUT of sourceSite after D — at D the
      // source still had that stock, so add it back.
      if (m.sourceSiteId) {
        const row = await ensureRow(m.productId, m.sourceSiteId);
        if (row) row[field] += m.quantity;
      }
      // A movement that brought stock INTO targetSite after D — at D the
      // target didn't yet have it, so subtract.
      if (m.targetSiteId) {
        const row = await ensureRow(m.productId, m.targetSiteId);
        if (row) row[field] -= m.quantity;
      }
    }

    // Drop rows where both quantities ended up at zero (or negative — could
    // happen with legacy data) so the UI doesn't show ghost zero-rows.
    const data = Array.from(map.values()).filter(
      (r) => r.quantityNew !== 0 || r.quantityUsed !== 0,
    );

    res.json({ success: true, data, snapshotDate: cutoff.toISOString() });
  } catch (error) {
    next(error);
  }
};

export const getByProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params.productId as string;

    const stocks = await prisma.stock.findMany({
      where: { productId },
      include: {
        site: true,
      },
      orderBy: { site: { name: 'asc' } },
    });

    // Calculer le total
    const totals = stocks.reduce(
      (acc, stock) => ({
        totalNew: acc.totalNew + stock.quantityNew,
        totalUsed: acc.totalUsed + stock.quantityUsed,
      }),
      { totalNew: 0, totalUsed: 0 }
    );

    res.json({
      success: true,
      data: {
        stocks,
        totals: {
          ...totals,
          total: totals.totalNew + totals.totalUsed,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getBySite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = req.params.siteId as string;

    const stocks = await prisma.stock.findMany({
      where: { siteId },
      include: {
        product: {
          include: {
            productSuppliers: {
              where: { isPrimary: true },
              include: { supplier: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { product: { reference: 'asc' } },
    });

    res.json({ success: true, data: stocks });
  } catch (error) {
    next(error);
  }
};

export const getAlerts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Produits avec risque appro HIGH et stock faible
    const products = await prisma.product.findMany({
      where: {
        supplyRisk: 'HIGH',
      },
      include: {
        stocks: {
          include: { site: true },
        },
        productSuppliers: {
          where: { isPrimary: true },
          include: { supplier: true },
          take: 1,
        },
        assemblyTypes: { select: { qtyPerUnit: true } },
      },
    });

    // Filtrer les produits avec stock total <= min(qtyPerUnit) * 5 (seuil arbitraire)
    const alerts = products
      .map((product) => {
        const totalStock = product.stocks.reduce(
          (sum, s) => sum + s.quantityNew + s.quantityUsed,
          0
        );
        const qtys = product.assemblyTypes.map((t) => t.qtyPerUnit).filter((q) => q > 0);
        const minQty = qtys.length > 0 ? Math.min(...qtys) : 1;
        const threshold = minQty * 5;
        return {
          ...product,
          totalStock,
          threshold,
          isCritical: totalStock <= threshold,
        };
      })
      .filter((p) => p.isCritical)
      .sort((a, b) => a.totalStock - b.totalStock);

    res.json({ success: true, data: alerts });
  } catch (error) {
    next(error);
  }
};
