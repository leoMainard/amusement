"""REST : création d'un salon, avant d'ouvrir la connexion WebSocket
(voir `game_ws.py`) — la création est une action ponctuelle, plus
naturelle en HTTP classique qu'en premier message d'un WebSocket."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from amusement.rooms.room import Room, RoomError, RoomMode

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


class CreateRoomRequest(BaseModel):
    game: str = "orapa_mine"
    mode: str  # "duel" | "fouille_parallel" | "fouille_turn_based"
    max_players: int = Field(default=2, ge=2, le=8)
    # Fixé une fois pour tout le salon (voir Room.extensions_enabled) :
    # évite qu'un joueur pose le Diamant/Corps noir pendant qu'un autre
    # s'en tient aux 5 gemmes de base.
    extensions_enabled: bool = False


class RoomResponse(BaseModel):
    code: str
    game: str
    mode: str
    max_players: int
    status: str
    extensions_enabled: bool


@router.post("", response_model=RoomResponse)
def create_room(payload: CreateRoomRequest, request: Request) -> RoomResponse:
    manager = request.app.state.room_manager
    try:
        mode = RoomMode[payload.mode.upper()]
    except KeyError:
        raise HTTPException(status_code=422, detail=f"Mode inconnu : {payload.mode!r}") from None

    try:
        room = manager.create_room(payload.game, mode, payload.max_players, payload.extensions_enabled)
    except RoomError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    return _room_response(room)


@router.get("/{code}", response_model=RoomResponse)
def get_room(code: str, request: Request) -> RoomResponse:
    # Portail multi-jeux (Phase 6) : un lien de salon partagé (?room=CODE)
    # ne dit pas de lui-même à quel jeu il appartient — le frontend
    # interroge cette route pour le savoir avant d'ouvrir le bon écran.
    manager = request.app.state.room_manager
    try:
        room = manager.get(code)
    except RoomError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    return _room_response(room)


def _room_response(room: Room) -> RoomResponse:
    return RoomResponse(
        code=room.code,
        game=room.game,
        mode=room.mode.name,
        max_players=room.max_players,
        status=room.status.name,
        extensions_enabled=room.extensions_enabled,
    )
