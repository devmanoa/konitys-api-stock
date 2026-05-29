import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalProducts,
      totalSuppliers,
      totalSites,
      pendingOrders,
      completedOrdersThisMonth,
      stocks,
      highRiskProducts,
      productsWithQty,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.supplier.count(),
      prisma.site.count({ where: { type: 'STORAGE', isActive: true } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({
        where: {
          status: 'COMPLETED',
          receivedDate: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      prisma.stock.findMany({
        include: {
          product: {
            include: {
              productSuppliers: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
          site: true,
        },
      }),
      prisma.product.count({ where: { supplyRisk: 'HIGH' } }),
      prisma.product.findMany({
        select: {
          id: true,
          assemblyTypes: { select: { qtyPerUnit: true } },
        },
      }),
    ]);

    // Calculer la valeur totale du stock et les totaux
    let totalStockValue = 0;
    let totalItems = 0;
    let totalStockNew = 0;
    let totalStockUsed = 0;

    // Map productId -> total stock
    const productStockMap = new Map<string, { new: number; used: number }>();

    stocks.forEach((stock) => {
      totalStockNew += stock.quantityNew;
      totalStockUsed += stock.quantityUsed;
      const qty = stock.quantityNew + stock.quantityUsed;
      totalItems += qty;
      const price = stock.product.productSuppliers[0]?.unitPrice;
      if (price) {
        totalStockValue += qty * Number(price);
      }

      // Aggregate by product
      const existing = productStockMap.get(stock.productId) || { new: 0, used: 0 };
      productStockMap.set(stock.productId, {
        new: existing.new + stock.quantityNew,
        used: existing.used + stock.quantityUsed,
      });
    });

    // "Unités possibles" = min(qtyPerUnit) across the product's assembly types
    let totalPossibleUnits = 0;
    productsWithQty.forEach((product) => {
      const stockData = productStockMap.get(product.id);
      const qtys = product.assemblyTypes.map((t) => t.qtyPerUnit).filter((q) => q > 0);
      if (stockData && qtys.length > 0) {
        const minQty = Math.min(...qtys);
        const totalQty = stockData.new + stockData.used;
        totalPossibleUnits += Math.floor(totalQty / minQty);
      }
    });

    res.json({
      success: true,
      data: {
        totalProducts,
        totalSuppliers,
        totalSites,
        pendingOrders,
        completedOrdersThisMonth,
        totalItems,
        totalStockNew,
        totalStockUsed,
        totalStockValue: Math.round(totalStockValue * 100) / 100,
        highRiskProducts,
        totalPossibleUnits,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getRecentMovements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      include: {
        product: true,
        sourceSite: true,
        targetSite: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({ success: true, data: movements });
  } catch (error) {
    next(error);
  }
};

export const getPendingOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'PENDING' },
      include: {
        supplier: true,
        destinationSite: true,
        items: { include: { product: true } },
      },
      orderBy: { expectedDate: 'asc' },
      take: 10,
    });

    res.json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

// Alertes stock bas - produits avec stock < seuil ou risque élevé
export const getLowStockAlerts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseInt(req.query.threshold as string) || 5;

    // Récupérer tous les produits avec leurs stocks
    const products = await prisma.product.findMany({
      include: {
        stocks: {
          include: { site: true },
        },
        productSuppliers: {
          where: { isPrimary: true },
          include: { supplier: true },
          take: 1,
        },
        assembly: true,
        assemblyTypes: {
          include: { assemblyType: { select: { id: true, name: true } } },
        },
      },
    });

    // Filtrer les produits avec stock bas
    const lowStockProducts = products
      .map((product) => {
        const totalNew = product.stocks.reduce((sum: number, s: any) => sum + s.quantityNew, 0);
        const totalUsed = product.stocks.reduce((sum: number, s: any) => sum + s.quantityUsed, 0);
        const total = totalNew + totalUsed;
        const qtys = product.assemblyTypes.map((t) => t.qtyPerUnit).filter((q) => q > 0);
        const minQty = qtys.length > 0 ? Math.min(...qtys) : 0;
        const possibleUnits = minQty > 0 ? Math.floor(total / minQty) : 0;
        // For UI compatibility, expose the first linked type as 'assemblyType'
        const firstType = product.assemblyTypes[0]?.assemblyType || null;

        return {
          id: product.id,
          reference: product.reference,
          description: product.description,
          imageUrl: product.imageUrl,
          assembly: product.assembly?.name,
          assemblyType: firstType ? { id: firstType.id, name: firstType.name } : null,
          assemblyTypes: product.assemblyTypes.map((t) => ({
            id: t.assemblyType.id,
            name: t.assemblyType.name,
            qtyPerUnit: t.qtyPerUnit,
          })),
          qtyPerUnit: minQty,
          supplyRisk: product.supplyRisk,
          minStock: product.minStock,
          totalNew,
          totalUsed,
          total,
          possibleUnits,
          primarySupplier: product.productSuppliers[0]?.supplier?.name,
          leadTime: product.productSuppliers[0]?.leadTime,
        };
      })
      .filter((p) => {
        const hasCriticalThreshold = p.minStock != null && p.minStock > 0;
        const isBelowThreshold = hasCriticalThreshold && p.total <= p.minStock!;
        // Alerter si:
        //  - un seuil critique est défini et le stock est en dessous (l'utilisateur surveille
        //    explicitement ce produit, même si total = 0)
        //  - OU le produit est à risque HIGH ET il reste du stock à surveiller
        // Un produit HIGH déjà à 0 sans seuil défini n'est plus en alerte: trop tard pour
        // réagir, ça pollue la liste.
        if (isBelowThreshold) return true;
        if (p.supplyRisk === 'HIGH' && p.total > 0) return true;
        return false;
      })
      .sort((a, b) => {
        // Trier par risque puis par stock
        if (a.supplyRisk === 'HIGH' && b.supplyRisk !== 'HIGH') return -1;
        if (b.supplyRisk === 'HIGH' && a.supplyRisk !== 'HIGH') return 1;
        return a.total - b.total;
      });

    res.json({ success: true, data: lowStockProducts });
  } catch (error) {
    next(error);
  }
};

// Données pour graphique: mouvements par jour (30 derniers jours)
export const getMovementsByDay = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const movements = await prisma.stockMovement.findMany({
      where: {
        movementDate: { gte: startDate },
      },
      select: {
        type: true,
        quantity: true,
        movementDate: true,
      },
      orderBy: { movementDate: 'asc' },
    });

    // Grouper par jour et type
    const dailyData = new Map<string, { date: string; IN: number; OUT: number; TRANSFER: number }>();

    // Initialiser tous les jours
    for (let i = 0; i <= days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const key = date.toISOString().split('T')[0];
      dailyData.set(key, { date: key, IN: 0, OUT: 0, TRANSFER: 0 });
    }

    // Agréger les mouvements
    movements.forEach((m) => {
      const key = new Date(m.movementDate).toISOString().split('T')[0];
      const dayData = dailyData.get(key);
      if (dayData) {
        dayData[m.type as 'IN' | 'OUT' | 'TRANSFER'] += m.quantity;
      }
    });

    res.json({ success: true, data: Array.from(dailyData.values()) });
  } catch (error) {
    next(error);
  }
};

// Données pour graphique: stock par site
export const getStockBySite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await prisma.site.findMany({
      where: { type: 'STORAGE', isActive: true },
      include: {
        stocks: true,
      },
    });

    const siteData = sites.map((site) => ({
      name: site.name,
      totalNew: site.stocks.reduce((sum, s) => sum + s.quantityNew, 0),
      totalUsed: site.stocks.reduce((sum, s) => sum + s.quantityUsed, 0),
      productCount: site.stocks.length,
    }));

    res.json({ success: true, data: siteData });
  } catch (error) {
    next(error);
  }
};

// Données pour graphique: top produits par stock
export const getTopProductsByStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const products = await prisma.product.findMany({
      include: {
        stocks: true,
        assembly: true,
      },
    });

    const productData = products
      .map((product) => ({
        id: product.id,
        reference: product.reference,
        description: product.description,
        assembly: product.assembly?.name || 'Sans type',
        totalNew: product.stocks.reduce((sum: number, s: any) => sum + s.quantityNew, 0),
        totalUsed: product.stocks.reduce((sum: number, s: any) => sum + s.quantityUsed, 0),
        total: product.stocks.reduce((sum: number, s: any) => sum + s.quantityNew + s.quantityUsed, 0),
      }))
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    res.json({ success: true, data: productData });
  } catch (error) {
    next(error);
  }
};

// Données pour graphique: commandes par mois
export const getOrdersByMonth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const months = parseInt(req.query.months as string) || 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months + 1);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        orderDate: { gte: startDate },
      },
      select: {
        status: true,
        orderDate: true,
        items: { select: { quantity: true } },
      },
    });

    // Grouper par mois
    const monthlyData = new Map<string, { month: string; pending: number; completed: number; cancelled: number; totalQty: number }>();

    // Initialiser tous les mois
    for (let i = 0; i < months; i++) {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
      monthlyData.set(key, { month: monthName, pending: 0, completed: 0, cancelled: 0, totalQty: 0 });
    }

    // Agréger les commandes
    orders.forEach((order) => {
      const date = new Date(order.orderDate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthData = monthlyData.get(key);
      if (monthData) {
        const orderTotalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
        monthData.totalQty += orderTotalQty;
        if (order.status === 'PENDING') monthData.pending++;
        else if (order.status === 'COMPLETED') monthData.completed++;
        else if (order.status === 'CANCELLED') monthData.cancelled++;
      }
    });

    res.json({ success: true, data: Array.from(monthlyData.values()) });
  } catch (error) {
    next(error);
  }
};
