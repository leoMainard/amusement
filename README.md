# Amusement

Site de jeux en ligne entre amis. Premier jeu : **Orapa Mine**, un jeu de
déduction à base de rayons réfléchis sur des gemmes, avec plateau rendu
en 3D et deux modes de jeu (Duel, Fouille).

Voir [`docs/plan.md`](docs/plan.md) pour le plan détaillé, les décisions
prises et les points encore ouverts.

## Structure du dépôt

- `src/amusement/` — backend Python (FastAPI + WebSockets)
  - `engine/` — logique de règles pure, par jeu, sans dépendance framework
  - `api/` — routes HTTP/WebSocket
  - `rooms/` — gestion générique des salons (par lien, sans compte)
- `frontend/` — frontend TypeScript + Three.js (Vite)
  - `src/games/` — rendu et interactions par jeu
  - `src/pages/notice/`, `src/pages/guide/` — règles reformulées et
    tutoriels interactifs, par jeu
- `docs/` — plan et documentation de conception
- `tests/` — tests du backend (pytest), miroir de `src/amusement/`
- `regles/` — livrets de règles officiels, référence de travail
  uniquement (non versionné, jamais copié dans le site)

## Développement

### Backend

```sh
uv sync
uv run pytest
uv run uvicorn amusement.api.main:app --reload
```

### Frontend

```sh
cd frontend
npm install
npm run dev
```

> Node.js 20.19+ ou 22.12+ recommandé (Vite 8). Une version plus ancienne
> fonctionne mais affiche un avertissement.

Backend et frontend doivent tourner **en même temps**, dans deux
terminaux séparés, pour que le site fonctionne (sinon : `Failed to
fetch` côté frontend).

## Tester en multijoueur

### Solo, ou à deux sur la même machine

Ouvre `http://localhost:5173` dans deux onglets/fenêtres : l'un crée la
partie, l'autre rejoint avec le code affiché.

### Avec un ami sur le même Wi-Fi (téléphone, autre PC...)

1. Lance le backend en écoutant sur le réseau, pas juste `localhost` :
   ```sh
   uv run uvicorn amusement.api.main:app --host 0.0.0.0
   ```
2. `npm run dev` (le frontend écoute déjà sur le réseau par défaut,
   voir `frontend/vite.config.ts`) — la sortie affiche une ligne
   `Network:` avec l'IP de la machine (ex : `192.168.1.79`).
3. **Les deux appareils doivent utiliser la même adresse** :
   `http://<IP-de-la-machine>:5173` des deux côtés. Ne mélange pas
   `localhost` (PC) et l'IP réseau (téléphone) pour une même partie —
   ce sont deux façons d'atteindre le même serveur, mais autant rester
   cohérent. Le frontend déduit automatiquement l'adresse du backend à
   partir de celle utilisée pour charger la page (voir
   `frontend/src/lib/config.ts`).

⚠️ Ne fais jamais tourner deux instances du backend en même temps (par
exemple une lancée avec `--reload` restée active en fond, plus une
nouvelle) : chacune a sa propre mémoire de salons, donc un salon créé
sur l'une est invisible depuis l'autre — symptôme observé : impossible
de rejoindre une partie pourtant bien créée. Si ça arrive, vérifie qui
écoute sur le port 8000 avant de relancer :
```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

### Avec quelqu'un hors de ton réseau (tunnel temporaire)

Sans déploiement réel, la solution rapide est un tunnel
[Cloudflare](https://github.com/cloudflare/cloudflared) (gratuit, pas
de compte requis pour un tunnel "quick") :

```sh
cloudflared tunnel --url http://localhost:8000   # backend -> URL A
cloudflared tunnel --url http://localhost:5173   # frontend -> URL B
```

Chaque commande affiche une URL `https://....trycloudflare.com`
différente. Comme frontend et backend se retrouvent alors sur deux
adresses différentes, indique l'URL du backend (URL A) au frontend via
`frontend/.env.local` (non versionné) :

```
VITE_API_BASE_URL=https://<URL-A>
VITE_WS_BASE_URL=wss://<URL-A>
```

Redémarre `npm run dev` (Vite ne recharge pas `.env.local` à chaud),
puis partage l'URL du **frontend** (URL B) à ton ami.

Ces tunnels "quick" sont éphémères et sans garantie de disponibilité —
pratiques pour un test ponctuel, pas pour un usage régulier. Une fois
le test terminé, arrête les tunnels (Ctrl+C) et supprime ou vide
`frontend/.env.local` pour repasser en mode LAN/localhost normal.

### En résumé

**Même Wi-Fi** — 2 terminaux :

```sh
# terminal 1 — backend
uv run uvicorn amusement.api.main:app --host 0.0.0.0

# terminal 2 — frontend
cd frontend
npm run dev
```

Puis ouvrir `http://<IP-de-la-machine>:5173` (ligne `Network:` affichée
par `npm run dev`) sur les deux appareils.

**Hors réseau (tunnel)** — 4 terminaux :

```sh
# terminal 1 — backend
uv run uvicorn amusement.api.main:app --host 0.0.0.0

# terminal 2 — tunnel backend (note l'URL affichée = URL A)
cloudflared tunnel --url http://localhost:8000

# terminal 3 — frontend (après avoir renseigné frontend/.env.local, voir ci-dessous)
cd frontend
npm run dev

# terminal 4 — tunnel frontend (note l'URL affichée = URL B, à partager)
cloudflared tunnel --url http://localhost:5173
```

Avant de lancer le terminal 3, renseigne l'URL A (backend) dans
`frontend/.env.local` :

```
VITE_API_BASE_URL=https://<URL-A>
VITE_WS_BASE_URL=wss://<URL-A>
```

Partage l'URL B (frontend, terminal 4) à ton ami.

**Tout arrêter** (avant de relancer proprement, ou si un port refuse de
se libérer — voir l'avertissement plus haut sur les instances dupliquées) :

```powershell
Get-Process node, python, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```
