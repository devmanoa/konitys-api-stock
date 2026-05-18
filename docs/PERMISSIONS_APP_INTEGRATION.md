# Intégration du système de permissions Konitys dans une app

> **Public** : les développeurs (humains et Claude) qui travaillent sur une app de la plateforme Konitys.
>
> **Objectif** : permettre à l'app d'être gérée par le "Mega gestionnaire de profils & droits" du Hub — exposer ses permissions, les respecter côté frontend et backend, et supporter le toggle d'enforcement global.

> **App key canonique pour ce projet : `stock`** (à utiliser dans `schema.app = "stock"` et sur `data-app-key="stock"`).

---

## ⚠️ Pour que l'intégration soit AUTO-MAINTENUE sans rappel

**Copie le snippet ci-dessous dans le `CLAUDE.md` à la racine de ton app** (crée-le s'il n'existe pas). C'est l'un des rares fichiers que Claude lit automatiquement à chaque nouvelle session — c'est ce qui permet à l'agent de **scanner l'app à chaque modif** sans qu'on ait à le lui rappeler.

### Snippet `CLAUDE.md` (à coller dans chaque app)

```markdown
## 🔐 Système de permissions Konitys (OBLIGATOIRE — lire à chaque session)

Cette app utilise le système de permissions centralisé Konitys. Le référentiel complet est dans
`<plateform-repo>/docs/PERMISSIONS_APP_INTEGRATION.md`.

### Règles à respecter systématiquement

**Avant de terminer TOUTE tâche** (feature, bugfix, refacto, PR) :

1. **Scanner les nouvelles routes API** : `grep -rn "router\.\(post\|put\|patch\|delete\)\|@app\.route.*POST\|@app\.route.*DELETE" <api-dir>`
   - Chaque nouvelle route d'écriture doit avoir un `requirePerm('<entity>.<action>')` ou équivalent.
   - Si une nouvelle clé de permission est nécessaire, l'ajouter dans `permissions-schema.js` (groupe approprié).

2. **Scanner les nouveaux boutons / actions sensibles** : nouveaux `<button>` avec `onClick`
   `create/edit/delete/archive/submit`, nouvelles entrées de menu/routes frontend.
   - Ajouter l'attribut `data-perm="<app>:<key>"` sur le DOM ou un check `window.__KONITYS_PERMS.has('<key>')` dans la logique de rendu.
   - Si la permission n'existe pas déjà, l'ajouter au schema.

3. **Scanner les nouvelles pages / routes frontend** : nouveaux fichiers de page, nouveaux `<Route>`.
   - Ajouter une permission `pages.<page>.view` dans le schema.
   - Ajouter un guard au mount : `if (!__KONITYS_PERMS.has('pages.<page>.view')) redirect('/403')`.

4. **Si le schema a changé** : après push/deploy, aller dans Admin > Profils & Droits > cliquer "Rafraîchir" sur cette app pour mettre à jour le cache gateway.

### Résumé workflow à chaque modif

- [ ] Le code ajoute une route d'écriture → `requirePerm` + schema ?
- [ ] Le code ajoute un bouton action → `data-perm` + schema ?
- [ ] Le code ajoute une page → `pages.X.view` + guard au mount ?
- [ ] Le schema a changé → tu me le dis explicitement dans la réponse finale, pour que je sache quoi rafraîchir.

### Comment gater

- **Backend** : décorer les routes avec `requirePerm('<app>', '<key>')`. Le middleware respecte la config enforcement automatiquement.
- **Frontend** : `data-perm="<app>:<key>"` sur le nœud + appeler `window.__KONITYS_PERMS.gateDom(container)` après chaque render. Les boutons non autorisés sont cachés.
- **Admin bypass** : les utilisateurs ayant le rôle Keycloak realm `admin` bypass tout (`is_admin: true` dans `/me`). Inutile de gérer un cas spécial.
- **Enforcement désactivé** : si l'enforcement global est OFF ou si cette app est en "mode dev", `has()` renvoie toujours `true` et les middlewares autorisent tout — les gates restent en place dans le code mais ne bloquent rien.

### Ne jamais faire

- ❌ Hardcoder une check admin dans le code (`if (user.id === 141)`) — utiliser le système de permissions
- ❌ Créer une route d'écriture sans `requirePerm`
- ❌ Supprimer une clé de permission du schema (laisser orphelines les grants DB) — utiliser plutôt une migration de renommage
```

---

## Prompt à coller tel quel à votre instance Claude Code

```text
Analyse l'application courante et mets en place le système de permissions Konitys en suivant ce contrat :

1. DÉCOUVERTE
   - Liste toutes les PAGES / ROUTES frontend (menu principal, sous-routes)
   - Liste toutes les ACTIONS métiers côté frontend (boutons create/edit/delete, modales, toggles sensibles)
   - Liste toutes les ROUTES API backend qui modifient de la donnée (POST/PUT/PATCH/DELETE)
   - Identifie pour chaque action la clé naturelle (ex: `contacts.create`, `pages.carte.view`, `historique.delete_any`)

2. SCHEMA À EXPOSER
   - Si l'app utilise `lib/adminpanel` partagé : crée `routes/permissions-schema.js` qui exporte
     `buildPermissionsSchema(appName)` retournant un objet `{ app, label, version, groups: [{ key, label, permissions: [{ key, label, description? }] }] }`.
     Branche-le AVANT `router.use('/adminpanel', requireAdmin)` dans `lib/adminpanel/index.js` :
         router.get('/adminpanel/permissions-schema', (_req, res) => res.json(buildPermissionsSchema(config.appName)));
   - Sinon (Flask, FastAPI, autre) : crée un endpoint PUBLIC `GET /adminpanel/permissions-schema` qui renvoie ce JSON.
   - Groupes recommandés par défaut : `access`, `pages` (une permission .view par page), puis un groupe par entité (`contacts`, `bornes`, etc.)
     avec les actions .create/.edit/.delete/.view quand applicables.
   - Pour les actions qui distinguent "mes propres" vs "tous" (modération), crée deux clés : `.edit_own` et `.edit_any`.

3. UX DE REFUS D'ACCÈS (OBLIGATOIRE — règle standardisée)

   Quand l'accès est refusé à une page (pas une API), renvoyer une page
   HTML neutre et professionnelle. Ne JAMAIS exposer la clé de permission
   technique à l'utilisateur final — elle ne sert que les devs/admins et
   doit uniquement apparaître dans les logs serveur.

   Règle de redirection standardisée pour le bouton de la page de refus :
     a. Le compte n'a pas le droit `app.access` sur l'app courante :
        → bouton redirige vers le PLATEFORM_URL (accueil du Hub)
     b. Le compte n'a pas non plus accès au Hub (`hub:app.access`) :
        → PAS de bouton (juste le message et l'icône)
     c. Le compte a le droit `app.access` mais pas la permission spécifique :
        → bouton redirige vers `/` (racine de l'app)

   **Le thème (couleurs, icône, textes, typo) est géré centralement** via
   l'admin panel → Apparence → « Page d'accès refusé ». Chaque app doit
   synchroniser le thème via le mécanisme décrit au point « Thème partagé ».

   Utiliser le template HTML dynamique fourni en annexe « Template HTML
   page 403 » qui consomme les variables du thème.

3bis. THÈME PARTAGÉ DE LA PAGE DE REFUS

   Le gateway expose deux endpoints PUBLICS (sans auth) :
   - `GET /config/deny-theme/version` → `{ version: int, updated_at }`
   - `GET /config/deny-theme.json` → `{ config: {...}, version, updated_at }`

   Chaque app doit implémenter un sync **lazy** :
   - Cache local sur disque (ex: `data/deny-theme.json`) + cache mémoire
   - Au premier refus d'accès (ou au boot), si `now - last_check > 5 min` :
     * fetch `/config/deny-theme/version`
     * si `remote_version > local_version` : fetch `/config/deny-theme.json`,
       persister sur disque, charger en mémoire
   - Fail-open : si le gateway est injoignable, utiliser le thème en cache
     (ou le thème par défaut intégré au code)

   Le thème a la forme suivante (chaque champ a une valeur par défaut) :
   ```json
   {
     "page":    { "bg_from": "#...", "bg_to": "#...", "padding": 24 },
     "card":    { "bg": "#...", "radius": 20, "shadow": "none|light|medium|heavy", "padding_y": 40, "padding_x": 40 },
     "icon":    { "preset": "lock|shield|ban|alert|xcircle", "size": 88, "bg_from": "#...", "bg_to": "#...", "color": "#...", "radius": 50, "dashed_border": true },
     "title":   { "text": "...", "color": "#...", "size": 22, "weight": 700, "letter_spacing": -0.01 },
     "message": { "text": "...", "color": "#...", "size": 14 },
     "button":  { "bg": "#...", "bg_hover": "#...", "color": "#...", "radius": 10, "shadow": true }
   }
   ```

   Le libellé du bouton (« Retour au Hub » vs « Retour à l'accueil »)
   reste **dynamique** côté app selon la règle de redirect du point 3 —
   il n'est PAS dans le thème.

4. GATING FRONTEND
   - Le SDK `konitys-perms.js` est auto-chargé par `konitys-header.js` — aucune intégration à faire si l'app utilise déjà le header fédéré.
   - Sinon : ajouter le script tag avec `data-gateway`, `data-token`, `data-app-key="<canonical>"`.
   - Pour chaque page / bouton sensible, ajouter l'attribut `data-perm="<key>"` sur le nœud à cacher,
     OU utiliser `window.__KONITYS_PERMS.has('key')` dans la logique de rendu.
   - Au démarrage : `await window.__KONITYS_PERMS.ready(); window.__KONITYS_PERMS.gateDom(document);`
   - Guard page-level (React/Vue) : dans le router, faire `if (!__KONITYS_PERMS.has('pages.X.view')) redirect('/403')`.

5. GATING BACKEND
   - Créer un middleware réutilisable `requirePerm('key')` qui :
     a. lit le Bearer token (ou la session)
     b. appelle `GET <gateway>/api/permissions/me` (avec cache in-memory 30s par userId/token)
     c. si `data.is_admin` → autorise
     d. si enforcement OFF pour cette app → autorise
     e. sinon vérifie `data.apps[<app_key>]?.[<key>]`
     f. si refusé : pour une route de page → renvoyer la page HTML standard ; pour une route API → renvoyer 403 JSON
   - La page HTML standard applique la règle de redirect (voir point 3).
   - Message utilisateur STANDARD : « Accès non autorisé. Contactez votre administrateur. » — JAMAIS la clé de permission.

6. RESPECT DU TOGGLE D'ENFORCEMENT
   - Frontend ET backend DOIVENT respecter la config `enforcement` retournée par `/api/permissions/me`.
     Ce n'est pas optionnel — sans ça, le bouton « mettre une app en mode dev » côté admin n'a aucun effet.

7. CONVENTIONS
   - App `app_key` : c'est la valeur déclarée par votre app dans son schema (`schema.app`). Le gateway la persiste en DB.
   - Passer explicitement `data-app-key="<canonical>"` sur la balise `konitys-header.js` quand le display name et le schema.app diffèrent (ex: "QR Code Generator" → `qrcode`).
   - Les clés de permission sont en snake_case séparé par des points : `entity.action` ou `entity.action_scope`.
   - Ne pas supprimer de clés existantes sans migration — les grants stockés en DB deviendraient orphelins.

8. MISE À JOUR INCRÉMENTALE
   - Après chaque ajout de page/action : mettre à jour `permissions-schema.js` + ajouter les gates au même endroit.
   - Cliquer "Rafraîchir" sur la page Admin > Profils & Droits pour que le Hub recache le schéma.
   - Si enforcement est désactivé globalement ou pour cette app, les nouveaux gates n'auront aucun effet jusqu'à activation — parfait pour merger sans casser la prod.

9. DOC INTERNE
   - Dans le README de l'app, documenter : les clés exposées, les apps "en mode dev" par défaut, comment tester avec un profil donné.

Livrables attendus : `permissions-schema.js` + endpoint public + middleware `requirePerm` (avec page HTML standard) + intégration sur au moins 3 routes/boutons en exemple.
```

---

## Template HTML page 403 (réutilisable, dynamique)

Cette page est **standard** pour toute la plateforme. Tous les paramètres visuels (couleurs, tailles, icône, textes) sont injectés depuis le thème partagé servi par le gateway (voir point 3bis). Seul le `redirect_url` / `redirect_label` reste calculé côté app selon la règle de redirect.

**Référence des icônes** — 5 presets supportés (matchés sur `t.icon.preset`) :

| preset    | svg (contenu entre `<svg>...</svg>`) |
|-----------|---------------------------------------|
| `lock`    | `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>` |
| `shield`  | `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>` |
| `ban`     | `<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>` |
| `alert`   | `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>` |
| `xcircle` | `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>` |

**Référence des shadows** — 4 presets (matchés sur `t.card.shadow`) :

| preset    | CSS box-shadow |
|-----------|----------------|
| `none`    | `none` |
| `light`   | `0 4px 12px rgba(15,23,42,0.04)` |
| `medium`  | `0 20px 50px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.04)` |
| `heavy`   | `0 30px 80px rgba(15,23,42,0.15), 0 8px 20px rgba(15,23,42,0.08)` |

**Template Jinja2 / Handlebars-like** (substituez `t` par l'objet thème courant) :

```html
<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{ t.title.text }}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:{{ t.page.padding }}px;background:linear-gradient(135deg,{{ t.page.bg_from }} 0%,{{ t.page.bg_to }} 100%);color:{{ t.title.color }}}
.card{background:{{ t.card.bg }};border-radius:{{ t.card.radius }}px;padding:{{ t.card.padding_y }}px {{ t.card.padding_x }}px;max-width:440px;width:100%;text-align:center;box-shadow:{{ shadow_css }}}
.icon-wrap{width:{{ t.icon.size }}px;height:{{ t.icon.size }}px;border-radius:{{ t.icon.radius }}%;background:linear-gradient(135deg,{{ t.icon.bg_from }} 0%,{{ t.icon.bg_to }} 100%);margin:0 auto 24px;display:flex;align-items:center;justify-content:center;position:relative;color:{{ t.icon.color }}}
{% if t.icon.dashed_border %}.icon-wrap::before{content:'';position:absolute;inset:-6px;border-radius:{{ t.icon.radius }}%;border:2px dashed {{ t.icon.color }}55;opacity:.6}{% endif %}
h1{font-size:{{ t.title.size }}px;font-weight:{{ t.title.weight }};margin-bottom:12px;color:{{ t.title.color }};letter-spacing:{{ t.title.letter_spacing }}em}
p{color:{{ t.message.color }};font-size:{{ t.message.size }}px;line-height:1.6;margin-bottom:28px}
a{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:{{ t.button.bg }};color:{{ t.button.color }};text-decoration:none;border-radius:{{ t.button.radius }}px;font-weight:600;font-size:14px;transition:all .15s{% if t.button.shadow %};box-shadow:0 4px 12px {{ t.button.bg }}40{% endif %}}
a:hover{background:{{ t.button.bg_hover }};transform:translateY(-1px)}
</style></head>
<body><div class="card">
<div class="icon-wrap"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{{ icon_svg|safe }}</svg></div>
<h1>{{ t.title.text }}</h1>
<p>{{ t.message.text }}</p>
{% if redirect_url %}<a href="{{ redirect_url }}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>{{ redirect_label }}</a>{% endif %}
</div></body></html>
```

**Pseudo-code sync côté app** :

```python
# Python / Flask
import time, json, os, requests
THEME_TTL = 300  # 5 min
state = {'config': None, 'version': 0, 'last_check': 0}
CACHE_FILE = '/app/data/deny-theme.json'

def get_theme():
    now = time.time()
    if state['config'] is None and os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            data = json.load(f)
            state['config'], state['version'] = data.get('config'), data.get('version', 0)
    if now - state['last_check'] >= THEME_TTL:
        state['last_check'] = now
        try:
            v = requests.get(f'{GATEWAY}/config/deny-theme/version', timeout=3).json()
            if int(v.get('version', 0)) > state['version']:
                full = requests.get(f'{GATEWAY}/config/deny-theme.json', timeout=5).json()
                state['config'] = full.get('config')
                state['version'] = full.get('version')
                os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
                with open(CACHE_FILE, 'w') as f: json.dump(full, f)
        except Exception: pass  # fail-open: use cached/default
    return state['config'] or DEFAULT_THEME
```

### Logique du `redirect_url` (identique pour toutes les apps)

```
- Compte n'a pas `<app>:app.access` (ou la clé demandée EST `app.access`)
    → Si compte a `hub:app.access` : redirect_url = PLATEFORM_URL,  redirect_label = "Retour au Hub"
    → Sinon :                        redirect_url = null (PAS de bouton)

- Compte a `<app>:app.access` mais lui manque la clé spécifique
    → redirect_url = "/", redirect_label = "Retour à l'accueil"
```

Cette logique DOIT être implémentée dans le middleware `requirePerm` côté backend, car c'est lui qui sert la page HTML.

## Référentiel technique

### Endpoints du Hub Gateway

Base URL DEV : `https://plateformdev-gateway.orkessi.com`
Base URL PROD : `https://plateform-gateway.orkessi.com`

| Méthode | Chemin | Auth | Usage |
|---|---|---|---|
| GET | `/api/permissions/me` | Bearer Keycloak | Permissions effectives de l'utilisateur + config enforcement. **À appeler par vos middlewares backend.** |
| GET | `/api/permissions/apps` | Bearer | Liste des apps côté admin (cache + app_key) |
| POST | `/api/permissions/apps/:key/refresh` | Bearer admin | Force le re-fetch du schéma de l'app |
| GET | `/api/permissions/apps/:key/schema` | Bearer | Schéma cache, auto-fetch si absent |
| GET | `/api/permissions/enforcement` | Bearer | Config actuelle du toggle |
| PUT | `/api/permissions/enforcement` | Bearer admin | `{ globally_enabled?, disabled_apps?[] }` |
| GET | `/api/permissions/profiles` | Bearer | Profils + stats |
| GET | `/api/permissions/profiles/:id/permissions` | Bearer | Grants par app |
| PUT | `/api/permissions/profiles/:id/permissions` | Bearer admin | `{ app_key, grants: { key: bool } }` |

### Réponse de `/api/permissions/me`

```json
{
  "data": {
    "user_id": "141",
    "apps": {
      "stock":  { "products.create": true, "products.edit": true },
      "qrcode": { "projects.view": true }
    },
    "is_admin": true,
    "profiles": [3, 8],
    "enforcement": { "globally_enabled": true, "disabled_apps": ["qrcode"] }
  }
}
```

### Exemple minimal de middleware Node/Express

```js
// middleware/requirePerm.js — message standard + redirect intelligent
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const CACHE_TTL_MS = 30_000;
const cache = new Map();
const APP_KEY = process.env.APP_KEY;          // ex: 'stock'
const GATEWAY = process.env.GATEWAY_URL;      // ex: 'https://plateform-gateway.orkessi.com'
const PLATEFORM = process.env.PLATEFORM_URL;  // ex: 'https://plateform.orkessi.com'
const DENIED_HTML = fs.readFileSync(path.join(__dirname, '../templates/403.html'), 'utf8');

async function loadMe(token) {
  const r = await fetch(`${GATEWAY}/api/permissions/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('permissions-me failed');
  return (await r.json()).data;
}

function isEnforced(e, appKey) {
  if (!e) return false;
  if (e.globally_enabled) {
    if (e.disable_specific && (e.disabled_apps || []).includes(appKey)) return false;
    return true;
  }
  if (e.enable_specific && (e.enabled_apps || []).includes(appKey)) return true;
  return false;
}

function canFor(me, appKey, permKey) {
  if (!me) return true;
  if (me.is_admin) return true;
  if (!isEnforced(me.enforcement, appKey)) return true;
  return !!(me.apps?.[appKey]?.[permKey]);
}

function redirectForDenial(me, currentPermKey) {
  const lacksAppAccess = currentPermKey === 'app.access' || !canFor(me, APP_KEY, 'app.access');
  if (lacksAppAccess) {
    if (PLATEFORM && canFor(me, 'hub', 'app.access')) return { url: PLATEFORM, label: 'Retour au Hub' };
    return null;
  }
  return { url: '/', label: "Retour à l'accueil" };
}

export function requirePerm(permKey) {
  return async (req, res, next) => {
    const token = (req.headers.authorization || '').slice(7);
    const userId = req.user?.user_id || req.user?.sub || 'anon';
    let entry = cache.get(userId);
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
      try { entry = { at: Date.now(), data: await loadMe(token) }; cache.set(userId, entry); }
      catch { return next(); } // fail-open if gateway unreachable
    }
    const me = entry.data;
    if (canFor(me, APP_KEY, permKey)) return next();

    // Refused: JSON 403 for API routes, styled HTML for pages
    const wantsJson = req.path.startsWith('/api/') || (req.headers.accept || '').includes('application/json');
    if (wantsJson) {
      return res.status(403).json({ error: 'Forbidden', message: 'Accès non autorisé. Contactez votre administrateur.' });
    }
    const redir = redirectForDenial(me, permKey);
    const html = DENIED_HTML
      .replace(/\{\{\s*if redirect_url\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g, redir ? '$1' : '')
      .replace(/\{\{\s*redirect_url\s*\}\}/g, redir?.url || '')
      .replace(/\{\{\s*redirect_label\s*\}\}/g, redir?.label || '');
    res.status(403).type('html').send(html);
  };
}
```

### Exemple minimal Python/Flask (décorateur page + API)

```python
# permissions.py — message standard + redirect intelligent
import os, time, requests
from functools import wraps
from flask import request, session, jsonify, render_template_string

GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
PLATEFORM_URL = os.environ.get("PLATEFORM_URL", "")
APP_KEY = "stock"   # à adapter par app
HUB_APP_KEY = "hub"
CACHE_TTL = 30.0
_cache = {}

# Le template HTML complet se trouve en annexe « Template HTML page 403 »
_DENIED_HTML = open(os.path.join(os.path.dirname(__file__), "templates", "403.html")).read()

def _load_me(token):
    if not token or not GATEWAY_URL: return None
    try:
        r = requests.get(f"{GATEWAY_URL.rstrip('/')}/api/permissions/me",
                         headers={"Authorization": f"Bearer {token}"}, timeout=5)
        return r.json().get("data") if r.status_code == 200 else None
    except Exception: return None

def _get_me():
    token = session.get("access_token", "")
    if not token: return None
    now = time.time()
    c = _cache.get(token)
    if c and now - c["at"] < CACHE_TTL: return c["data"]
    data = _load_me(token)
    if data is not None: _cache[token] = {"at": now, "data": data}
    return data

def _can_for(me, app_key, perm_key):
    if not me: return True
    if me.get("is_admin"): return True
    e = me.get("enforcement") or {}
    if e.get("globally_enabled"):
        if e.get("disable_specific") and app_key in (e.get("disabled_apps") or []): return True
        return bool((me.get("apps") or {}).get(app_key, {}).get(perm_key))
    if e.get("enable_specific") and app_key in (e.get("enabled_apps") or []):
        return bool((me.get("apps") or {}).get(app_key, {}).get(perm_key))
    return True

def can(perm_key):
    return _can_for(_get_me(), APP_KEY, perm_key)

def _redirect_on_denial(me, current_perm_key):
    lacks_app = current_perm_key == "app.access" or not _can_for(me, APP_KEY, "app.access")
    if lacks_app:
        if PLATEFORM_URL and _can_for(me, HUB_APP_KEY, "app.access"):
            return {"url": PLATEFORM_URL, "label": "Retour au Hub"}
        return None
    return {"url": "/", "label": "Retour à l'accueil"}

def require_perm(perm_key):
    def deco(fn):
        @wraps(fn)
        def wrapped(*a, **kw):
            if can(perm_key): return fn(*a, **kw)
            wants_json = request.path.startswith("/api/") or "application/json" in (request.headers.get("Accept") or "")
            if wants_json:
                return jsonify({"error": "Forbidden", "message": "Accès non autorisé. Contactez votre administrateur."}), 403
            me = _get_me()
            redir = _redirect_on_denial(me, perm_key)
            return render_template_string(
                _DENIED_HTML,
                redirect_url=(redir["url"] if redir else None),
                redirect_label=(redir["label"] if redir else ""),
            ), 403
        return wrapped
    return deco
```

---

## Checklist de validation

Avant de considérer l'intégration terminée :

- [ ] `GET https://<app>/adminpanel/permissions-schema` retourne du JSON valide avec `groups`
- [ ] `GET /api/permissions/apps` sur le gateway inclut votre app, et clic "Rafraîchir" dans l'admin charge le schéma
- [ ] Au moins une permission est gatée côté **frontend** et une côté **backend**
- [ ] Quand enforcement est **désactivé globalement**, tout fonctionne comme avant
- [ ] Quand enforcement est **activé** avec votre app dans `disabled_apps`, tout fonctionne comme avant
- [ ] Quand enforcement est **activé** sans votre app dans `disabled_apps`, un utilisateur sans les permissions adéquates voit des erreurs 403 aux bons endroits et les boutons cachés
- [ ] Les utilisateurs avec le rôle Keycloak `admin` bypass tout
- [ ] Le fichier `CLAUDE.md` à la racine de l'app contient la section « Système de permissions Konitys »

---

## Script d'audit (à lancer après chaque feature)

Sauvegarde ce script sous `scripts/audit-permissions.sh` dans ton app. Il liste les routes d'écriture sans `requirePerm` et les boutons d'action sans `data-perm`, pour t'alerter rapidement des oublis.

```bash
#!/usr/bin/env bash
# audit-permissions.sh — détecte les gates manquants côté backend + frontend
set -u
ROOT="${1:-.}"

echo "── Routes backend sans requirePerm (Node/Express) ──"
grep -rn "router\.\(post\|put\|patch\|delete\)" "$ROOT" --include="*.js" --include="*.ts" 2>/dev/null \
  | grep -v node_modules \
  | grep -v "requirePerm" \
  | grep -v "require_perm" || echo "✔ aucune"

echo
echo "── Routes backend sans @require_perm (Python/Flask) ──"
grep -rnB 1 "^@.*route.*methods=\[.*'\(POST\|PUT\|PATCH\|DELETE\)" "$ROOT" --include="*.py" 2>/dev/null \
  | grep -v "require_perm" | grep -v "^--$" || echo "✔ aucune"

echo
echo "── Boutons frontend d'action sans data-perm ──"
grep -rn "<button[^>]*onClick=\"[^\"]*\(create\|edit\|delete\|archive\|remove\)" "$ROOT" \
  --include="*.html" --include="*.jsx" --include="*.tsx" 2>/dev/null \
  | grep -v "data-perm" || echo "✔ aucun"

echo
echo "── Nouvelles pages sans permission pages.*.view dans schema ──"
SCHEMA_FILE=$(find "$ROOT" -name "permissions-schema*" -not -path "*node_modules*" 2>/dev/null | head -1)
if [ -n "$SCHEMA_FILE" ]; then
  echo "(schema détecté: $SCHEMA_FILE → vérifier manuellement que chaque page a une clé pages.*.view)"
else
  echo "⚠️  AUCUN permissions-schema trouvé → créer avant toute chose !"
fi
```

Usage :
```bash
chmod +x scripts/audit-permissions.sh
./scripts/audit-permissions.sh ./api       # pour le backend
./scripts/audit-permissions.sh ./frontend  # pour le frontend
```

Claude peut (et devrait) le lancer automatiquement après avoir modifié le code, grâce à l'instruction dans le `CLAUDE.md` — le résultat lui permet de détecter instantanément les oublis à corriger.
