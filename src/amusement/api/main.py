"""Point d'entrée de l'application FastAPI.

Assemble les salons (`amusement.rooms`) et le moteur Orapa Mine
(`amusement.engine.orapa_mine`) derrière une API REST (création de
salon) et un WebSocket (déroulement de la partie) — voir `rooms_api.py`
et `game_ws.py`.
"""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from amusement.rooms.manager import RoomManager

from .connections import ConnectionManager
from .game_session import OrapaMineSession
from .game_ws import router as game_ws_router
from .rooms_api import router as rooms_router

app = FastAPI(
    title="Amusement",
    description="Plateforme de jeux en ligne entre amis.",
    version="0.1.0",
)

# v1 : pas de comptes, pas de données sensibles côté REST — origines
# ouvertes pour simplifier le dev (frontend Vite sur un autre port). À
# restreindre à l'origine réelle du site avant un déploiement public.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# État partagé en mémoire (v1 : pas de persistance, cohérent avec le
# choix "salons par lien, sans compte" — voir docs/plan.md).
app.state.room_manager = RoomManager()
app.state.connections = ConnectionManager()
app.state.sessions: dict[str, OrapaMineSession] = {}
# Une tâche d'arrière-plan par salon en cours de partie, qui force la
# fin du tour quand son chrono expire — voir game_ws.py
# (`_turn_timer_loop`/`_ensure_timer_task`).
app.state.timer_tasks: dict[str, asyncio.Task] = {}

app.include_router(rooms_router)
app.include_router(game_ws_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Contrôle de santé basique, utile pour le déploiement et les tests."""
    return {"status": "ok"}
