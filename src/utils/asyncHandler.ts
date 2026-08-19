import { Response, NextFunction, RequestHandler } from 'express';

/**
 * Enveloppe un handler async : toute rejection part dans next(err)
 * au lieu d'exiger un try/catch boilerplate dans chaque controller.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (req: any, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncFn): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
