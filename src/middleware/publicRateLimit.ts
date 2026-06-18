import { Request, Response, NextFunction } from 'express';

/**
 * Tiny in-memory rate limiter keyed by share-link id. Goal: stop a leaked
 * link from spam-posting hundreds of entries before an admin can revoke it.
 *
 * Process-local (no Redis), which means N replicas = N times the budget.
 * That's fine for the threat we care about — accidental floods and basic
 * abuse — and avoids a new infra dependency. If we ever scale horizontally
 * to the point this matters, swap for a shared store.
 *
 * Window is rolling per key. We sweep stale entries lazily on each call.
 */
const buckets = new Map<string, number[]>();

interface Opts {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per window per key. */
  max: number;
  /** How we identify a caller. Default = share-link id from params. */
  keyFromReq?: (req: Request) => string | null;
}

export function rateLimit(opts: Opts) {
  const { windowMs, max } = opts;
  const keyFromReq = opts.keyFromReq || ((req) => String(req.params.linkId || '') || null);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFromReq(req);
    if (!key) return next();

    const now = Date.now();
    const cutoff = now - windowMs;

    let arr = buckets.get(key) || [];
    // Drop stamps older than the window.
    if (arr.length && arr[0] < cutoff) {
      arr = arr.filter((t) => t >= cutoff);
    }

    if (arr.length >= max) {
      const retryAfterSec = Math.ceil((arr[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      return res.status(429).json({ success: false, error: 'Trop de requêtes — réessayez dans un instant' });
    }

    arr.push(now);
    buckets.set(key, arr);
    next();
  };
}
