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
