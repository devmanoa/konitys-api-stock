import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';

// photoNom is concatenated directly into a URL by the client:
//   `${gateway}/uploads/contacts/${photoNom}`
// So we MUST refuse any traversal (`../`), any slash, or any control char.
// Real photoNom values are gateway-generated filenames (UUID-ish).
const PHOTO_NOM_RE = /^[\w.-]{1,128}$/;

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

    // Validate user-supplied photoNom: refuse traversal / impersonation.
    let safePhotoNom: string | null = null;
    if (photoNom != null && photoNom !== '') {
      if (typeof photoNom !== 'string' || !PHOTO_NOM_RE.test(photoNom)) {
        throw new AppError('photoNom invalide', 400);
      }
      safePhotoNom = photoNom;
    }

    const data = {
      keycloakId,
      email: req.user.email || null,
      firstName: req.user.firstName || null,
      lastName: req.user.lastName || null,
      fullName: req.user.fullName || req.user.username || null,
      photoNom: safePhotoNom,
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
    // Public-ish list used by OperatorAvatar to look up profile pictures.
    // Email is intentionally omitted so authenticated callers can't enumerate
    // the company directory for phishing.
    const users = await prisma.user.findMany({
      select: {
        id: true,
        keycloakId: true,
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
