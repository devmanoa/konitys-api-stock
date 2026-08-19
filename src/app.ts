import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import routes from './routes';
import publicInventoryRoutes from './routes/publicInventory';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
console.log('CORS Origin configured:', corsOrigin);

// Garde-fou : CORS_ORIGIN="*" fait refleter l'Origin de la requete. Combine
// a credentials:true ce serait la config la plus dangereuse possible
// (n'importe quel site pourrait faire des requetes authentifiees cross-origin
// avec les cookies de l'utilisateur). L'app s'authentifie par header
// Authorization (Bearer Keycloak), qui ne depend pas de credentials — on
// coupe donc credentials quand l'origine est wildcard.
const corsWildcard = corsOrigin === '*';
if (corsWildcard) {
  console.warn(
    '[CORS] CORS_ORIGIN="*" : origines refletees SANS credentials. ' +
    'A reserver au debug — configurer une origine explicite en production.',
  );
}

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // API pure : on conserve la CSP par defaut de helmet (default-src 'self')
  // mais on la rend explicite. Si un jour le serveur sert du HTML (page 403
  // du systeme de permissions...), adapter cette policy ici au lieu de la
  // subir silencieusement.
  contentSecurityPolicy: { useDefaults: true },
}));
app.use(cors({
  origin: corsWildcard ? true : corsOrigin.includes(',') ? corsOrigin.split(',') : corsOrigin,
  credentials: !corsWildcard,
}));
// Limite volontairement haute pour permettre l'endpoint /admin/db-import
// qui recoit un dump JSON complet (peut atteindre 100+ MB sur une DB
// avec beaucoup de mouvements/audit logs).
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Serve uploaded files with CORS + security headers.
//   - Images under /uploads/products/* may be inlined (used by <img>).
//   - Any other folder (notably /uploads/files/*) is forced to download
//     via Content-Disposition: attachment, so a malicious HTML/SVG/PDF/etc.
//     cannot run JavaScript in the app's origin.
const uploadsPath = path.join(process.cwd(), 'uploads');
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // Defense in depth: tell sniffing browsers to trust the declared Content-Type.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Anything outside /uploads/products is forced to download.
  if (!req.path.startsWith('/products/')) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(uploadsPath, {
  // UUID filenames are immutable: cache aggressively.
  maxAge: '30d',
  immutable: true,
}));

// Simple ping endpoint (no DB required)
app.get('/', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Health check endpoint for Railway
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public mobile share-link endpoints. Mounted BEFORE /api so they bypass
// the global Keycloak auth — the linkId in the URL is the credential.
// All endpoints set no-store so a phone browser doesn't cache stale data
// after a link gets revoked.
app.use('/api/public', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // Trace forensique : le linkId dans l'URL est une credential publique. En
  // cas de fuite/abus d'un lien, ces logs (IP + user-agent par hit) sont le
  // seul moyen de reconstituer qui l'a utilise et quand.
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '-';
  console.log(
    `[public] ${req.method} ${req.originalUrl} ip=${ip} ua="${req.headers['user-agent'] || '-'}"`,
  );
  next();
}, publicInventoryRoutes);

// Routes
app.use('/api', routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
