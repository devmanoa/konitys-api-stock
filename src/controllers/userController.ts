import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthenticatedRequest } from '../types/auth';

/**
 * POST /api/users/sync
 *
 * Called by the client right after Keycloak init. Upserts the connected user
 * in our local `users` table together with the photoNom fetched from the
 * platform gateway. This is how we build the directory of "known users"
 * that other parts of the app render avatars for.
 *
 * Body: { photoNom?: string }   (optional — null/empty clears it)
 */
export const syncCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { photoNom } = (req.body || {}) as { photoNom?: string | null };
    const keycloakId = req.user.id;

    const data = {
      keycloakId,
      email: req.user.email || null,
      firstName: req.user.firstName || null,
      lastName: req.user.lastName || null,
      fullName: req.user.fullName || req.user.username || null,
      photoNom: photoNom ?? null,
      lastSeenAt: new Date(),
    };

    const user = await prisma.user.upsert({
      where: { keycloakId },
      update: data,
      create: data,
    });

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users
 *
 * Returns every user we've seen at least once (i.e. who has logged in to
 * stock-management). Used by OperatorAvatar to look up a profile picture
 * by name/keycloakId.
 *
 * Public-ish (still behind auth): no sensitive fields.
 */
export const listUsers = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        keycloakId: true,
        email: true,
        firstName: true,
        lastName: true,
        fullName: true,
        photoNom: true,
      },
      orderBy: { fullName: 'asc' },
    });
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/known
 *
 * Used by the @mention picker. Same data as listUsers, capped at 20 by
 * default, with an optional search.
 */
export const getKnownUsers = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const search = req.query.search as string | undefined;

    const where: any = {};
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const dbUsers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        keycloakId: true,
        fullName: true,
        email: true,
        photoNom: true,
      },
      orderBy: { fullName: 'asc' },
      take: 20,
    });

    // Keep backward-compatible shape for the existing MentionList.
    const users = dbUsers.map((u) => ({
      authorId: u.keycloakId,
      authorUsername: u.email || u.fullName || '',
      authorName: u.fullName || u.email || '',
      photoNom: u.photoNom,
    }));

    // Always include the current user even if their first sync hasn't landed yet.
    if (!users.some((u) => u.authorId === req.user.id)) {
      users.unshift({
        authorId: req.user.id,
        authorUsername: req.user.username,
        authorName: req.user.fullName || req.user.username,
        photoNom: null,
      });
    }

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};
