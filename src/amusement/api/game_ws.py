"""Connexion WebSocket d'un salon Orapa Mine : un message JSON entrant
par action (`{"type": "...", ...}`), une ou plusieurs réponses/diffusions
en sortie. Voir `game_session.py` pour la logique de jeu elle-même —
ce module ne fait que la relier au transport WebSocket et diffuser les
événements aux bons joueurs (voir docstring de chaque branche pour qui
reçoit quoi et pourquoi).
"""

from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from amusement.engine.orapa_mine import PlacementError
from amusement.engine.orapa_mine.duel import DuelError
from amusement.engine.orapa_mine.fouille import FouilleError
from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus

from .connections import ConnectionManager
from .game_session import OrapaMineSession, piece_from_payload, piece_to_payload

router = APIRouter()

# Toute erreur "attendue" (mauvaise action du joueur, pas un bug serveur)
# devient un message {"type": "error"} renvoyé au seul joueur concerné,
# plutôt que de faire planter sa connexion.
_EXPECTED_ERRORS = (RoomError, PlacementError, DuelError, FouilleError, ValueError, KeyError, TypeError)


def room_payload(room: Room) -> dict:
    return {
        "code": room.code,
        "game": room.game,
        "mode": room.mode.name,
        "max_players": room.max_players,
        "status": room.status.name,
        "extensions_enabled": room.extensions_enabled,
        "players": [{"id": p.id, "name": p.name} for p in room.players],
    }


def ray_result_payload(result) -> dict:
    return {
        "entry": list(result.entry),
        "entry_direction": result.entry_direction.name,
        "exit": list(result.exit) if result.exit else None,
        "exit_direction": result.exit_direction.name if result.exit_direction else None,
        "color": result.color,
        "absorbed": result.absorbed,
    }


def game_state_payload(session: OrapaMineSession) -> dict:
    if session.room.mode == RoomMode.DUEL:
        game = session.duel
        if game is None:
            return {}
        return {
            "current_prospector": game.current_prospector,
            "finished": game.finished,
            "winner": game.winner,
            "draw": game.draw,
        }

    game = session.fouille
    if game is None:
        return {}
    return {
        "current_turn_player": game.current_turn_player(),
        "eliminated": list(game.eliminated),
        "finished": game.finished,
        "winner": game.winner,
    }


@router.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str, name: str = Query(...)) -> None:
    app = websocket.app
    manager = app.state.room_manager
    connections: ConnectionManager = app.state.connections
    sessions: dict[str, OrapaMineSession] = app.state.sessions

    try:
        room = manager.get(code)
    except RoomError as exc:
        await websocket.close(code=4404, reason=str(exc))
        return

    try:
        player = room.add_player(name)
    except RoomError as exc:
        await websocket.close(code=4403, reason=str(exc))
        return

    await websocket.accept()
    connections.add(code, player.id, websocket)
    session = sessions.setdefault(code, OrapaMineSession(room))

    await websocket.send_json(
        {
            "type": "joined",
            "player_id": player.id,
            "room": room_payload(room),
            "dimensions": {"width": session.dimensions.width, "height": session.dimensions.height},
        }
    )
    await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)}, exclude=player.id)

    # Le salon vient de se remplir : on démarre automatiquement (pas de
    # bouton "lancer" côté hôte en v1 — voir docs/plan.md).
    if room.is_full():
        session.start()
        await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})
        if room.status == RoomStatus.PLAYING:
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

    try:
        while True:
            message = await websocket.receive_json()
            await _handle_message(code, player.id, session, room, connections, message)
    except WebSocketDisconnect:
        pass
    finally:
        connections.remove(code, player.id)
        room.remove_player(player.id)
        await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})


async def _handle_message(
    code: str,
    player_id: str,
    session: OrapaMineSession,
    room: Room,
    connections: ConnectionManager,
    message: dict,
) -> None:
    msg_type = message.get("type")
    try:
        if msg_type == "place_piece":
            # Réponse privée : la disposition d'un joueur ne doit
            # jamais transiter vers son adversaire avant la partie.
            piece = piece_from_payload(message["piece"])
            session.place_piece(player_id, piece)
            await connections.send_to(code, player_id, {"type": "placement_ack", "piece": piece_to_payload(piece)})

        elif msg_type == "remove_piece":
            session.remove_piece_at(player_id, tuple(message["position"]))
            await connections.send_to(code, player_id, {"type": "placement_ack", "removed": message["position"]})

        elif msg_type == "validate_placement":
            all_ready = session.validate_placement(player_id)
            # "prêt" est public (sans révéler le plateau), utile pour un
            # écran d'attente "en attente de l'adversaire".
            await connections.broadcast(code, {"type": "player_ready", "player_id": player_id})
            if all_ready:
                await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})
                await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

        elif msg_type == "ask_ray":
            result = session.ask_ray(player_id, message["entry_label"])
            payload = {"type": "ray_result", "entry_label": message["entry_label"], "result": ray_result_payload(result)}
            # Duel / Fouille parallèle : réponse privée au demandeur.
            # Fouille tour par tour : visible de tous (variante officielle).
            if room.mode == RoomMode.FOUILLE_TURN_BASED:
                await connections.broadcast(code, {**payload, "player_id": player_id})
            else:
                await connections.send_to(code, player_id, payload)
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

        elif msg_type == "ask_peek":
            result = session.ask_peek(player_id, tuple(message["position"]))
            payload = {"type": "peek_result", "position": message["position"], "result": result}
            if room.mode == RoomMode.FOUILLE_TURN_BASED:
                await connections.broadcast(code, {**payload, "player_id": player_id})
            else:
                await connections.send_to(code, player_id, payload)
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

        elif msg_type == "submit_solution":
            session.submit_solution(player_id, message["guess"])
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})
            if room.status == RoomStatus.FINISHED:
                await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})

        else:
            await connections.send_to(code, player_id, {"type": "error", "message": f"Type de message inconnu : {msg_type!r}"})

    except _EXPECTED_ERRORS as exc:
        await connections.send_to(code, player_id, {"type": "error", "message": str(exc)})
