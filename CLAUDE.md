## 🔐 OBLIGATOIRE — Système de permissions Konitys (auto-bootstrap + auto-maintenance)

**Cette section définit un comportement AUTOMATIQUE que tu DOIS appliquer à chaque session, sans attendre une demande explicite du développeur.** Le référentiel complet est dans `docs/PERMISSIONS_APP_INTEGRATION.md`.

> **App key canonique pour cette app : `stock`** — à déclarer dans `schema.app = "stock"` et à passer comme `APP_KEY=stock` (env var) au middleware `requirePerm`.
>
> **Périmètre de ce CLAUDE.md** : backend `server/` (Express + TypeScript + Prisma). Le frontend a son propre `CLAUDE.md` dans `client-stock/`.

### Routine 1 — Au démarrage de CHAQUE session (obligatoire, silencieux si rien à faire)

**AVANT** de traiter la demande de l'utilisateur, exécute ces checks dans l'ordre :

1. **Vérifier l'état du câblage côté backend** :
   - Existe-t-il un fichier `permissions-schema*` dans `src/` ou `src/routes/` ?
   - L'endpoint `GET /adminpanel/permissions-schema` est-il exposé publiquement (sans `requireAuth`) ?
   - Y a-t-il au moins un middleware `requirePerm` appliqué sur une route d'écriture ?
   - Un template HTML 403 existe-t-il dans `src/templates/` (ou équivalent) ?

2. **Décision** :
   - Si les 4 checks passent → setup OK, passe à la Routine 3 silencieusement.
   - Si un check échoue → **setup manquant ou incomplet**, exécute le BOOTSTRAP (Routine 2) avant de répondre à la demande de l'utilisateur. Informe-le à la fin de ce que tu as ajouté.

### Routine 2 — Bootstrap (uniquement si Routine 1 détecte un manque)

1. Lis intégralement `docs/PERMISSIONS_APP_INTEGRATION.md`.
2. Applique le contenu de la section « Prompt à coller tel quel à votre instance Claude Code » du document, pour la partie backend :
   - **Découverte** : liste toutes les routes API qui modifient la donnée (POST/PUT/PATCH/DELETE) — `grep -rn "router\.\(post\|put\|patch\|delete\)" src/`.
   - **Schema** : créer `src/routes/permissions-schema.ts` (ou `.js`) qui exporte une fonction `buildPermissionsSchema(appName)` retournant `{ app: "stock", label: "Stock Management", version, groups: [...] }`. Groupes recommandés : `access`, `pages`, puis un groupe par entité (`products`, `stocks`, `movements`, `orders`, `suppliers`, `sites`, `packs`, `assembly_types`, `order_templates`, `serial_items`, …).
   - **Endpoint public** : brancher `GET /adminpanel/permissions-schema` AVANT toute auth middleware, dans `src/index.ts`.
   - **Middleware** : créer `src/middleware/requirePerm.ts` selon l'exemple Node/Express du doc (cache in-memory 30s, fail-open sur erreur gateway).
   - **Page HTML 403** : copier le template Jinja-like du doc dans `src/templates/403.html`, branché par le middleware quand la requête veut du HTML.
   - **Sync thème** : implémenter le pattern version-check vers `GET /config/deny-theme/version` + `/config/deny-theme.json`. Cache sur disque + mémoire, TTL 5 min, fail-open.
   - **Application** : décorer au minimum 3 routes d'écriture avec `requirePerm('stock', '<key>')` en exemple.
3. Ne livre pas sans :
   - 1 endpoint public `/adminpanel/permissions-schema` fonctionnel
   - 1 route backend gatée
   - `src/templates/403.html` en place
4. Ajoute `scripts/audit-permissions.sh` (copie depuis le doc).
5. Notifie l'utilisateur en fin de réponse : liste ce qui a été ajouté, et rappelle de cliquer « Rafraîchir » dans Admin > Profils & Droits pour cacher le schema.

### Routine 3 — Audit à CHAQUE modification utilisateur (après bootstrap)

Quand l'utilisateur demande n'importe quelle modif touchant le backend :

1. **Scanne les fichiers que TU viens de toucher** :
   - Nouvelle route POST/PUT/PATCH/DELETE sans `requirePerm` ? → ajoute le middleware + une nouvelle clé au schema.
   - Route supprimée ? → **ne touche pas au schema** (garder les clés évite d'orpheliner les grants DB) ; signale-le dans la réponse.

2. **Lance le script d'audit** si présent : `bash scripts/audit-permissions.sh .`. Si gaps, corrige dans le même commit.

3. Si le schema a changé → indique-le explicitement : « Schema permissions mis à jour (+N clé(s) : `<list>`). Clique "Rafraîchir" dans Admin > Profils & Droits ».

### Règles absolues (à respecter sans exception)

- ❌ **Jamais** de check admin hardcodée (`if (user.id === 141)`) — utiliser le système de permissions
- ❌ **Jamais** une route d'écriture sans `requirePerm`
- ❌ **Jamais** supprimer une clé du schema (migration de renommage uniquement)
- ❌ **Jamais** contourner l'enforcement config (le middleware le respecte déjà, ne pas le shortcircuit)
- ✅ Les utilisateurs avec le rôle Keycloak `admin` bypass tout (via `is_admin: true` dans `/me`)
- ✅ Quand l'enforcement global est OFF ou que l'app est en `disabled_apps`, le middleware autorise tout

### Localisation des ressources

- Documentation complète : `docs/PERMISSIONS_APP_INTEGRATION.md`
- Script d'audit (à créer si absent) : `scripts/audit-permissions.sh`
- Admin Panel Profils & Droits : https://adminpaneldev.orkessi.com/hub/droits (DEV) / https://adminpanel.orkessi.com/hub/droits (PROD)
- Gateway endpoints : `https://plateform-gateway.orkessi.com/api/permissions/*`

### Fail-safe

Si la gateway est injoignable au moment où `requirePerm` s'exécute, il doit **fail-open** (autoriser) pour ne pas casser l'app. L'enforcement reprendra au prochain appel quand la gateway sera de nouveau disponible.

### Variables d'env attendues

Côté Coolify, ajouter sur ce service (server) :
- `APP_KEY=stock`
- `GATEWAY_URL=https://plateform-gateway.orkessi.com` (DEV : `https://plateformdev-gateway.orkessi.com`)
- `PLATEFORM_URL=https://plateform.orkessi.com` (DEV : `https://plateformdev.orkessi.com`)
