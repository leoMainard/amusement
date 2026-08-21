"""Connexion WebSocket d'un salon Orapa Mine : un message JSON entrant
par action (`{"type": "...", ...}`), une ou plusieurs réponses/diffusions
en sortie. Voir `game_session.py` pour la logique de jeu elle-même —
ce module ne fait que la relier au transport WebSocket et diffuser les
événements aux bons joueurs (voir docstring de chaque branche pour qui
reçoit quoi et pourquoi).
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from amusement.engine.orapa_mine import PlacementError
from amusement.engine.orapa_mine.duel import DuelError
from amusement.engine.orapa_mine.fouille import FouilleError
from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus

from .connections import ConnectionManager
from .game_session import OrapaMineSession, piece_from_payload, piece_to_payload

router = APIRouter()

# Granularité du sondage de `OrapaMineSession.turn_deadline` par
# `_turn_timer_loop` ci-dessous — pas un réveil unique programmé à
# l'avance, puisque le délai peut être repoussé à tout moment par une
# action de jeu (voir `_reset_turn_timer`) ; re-vérifier périodiquement
# est plus simple que d'annuler/reprogrammer un minuteur à chaque coup.
_TURN_TIMER_POLL_SECONDS = 2.0

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
            # Horodatage Unix (secondes) de fin du tour en cours, `None`
            # si non chronométré (voir `OrapaMineSession.turn_deadline`)
            # — le client calcule lui-même le compte à rebours affiché.
            "turn_deadline": session.turn_deadline,
            # Une seule question par tour (voir duel.py) : le client
            # désactive "Tirer un rayon"/"Interroger une case" une fois
            # `True`, plutôt que de laisser l'utilisateur découvrir le
            # refus après coup.
            "asked_this_turn": game.asked_this_turn,
        }

    game = session.fouille
    if game is None:
        return {}
    return {
        "current_turn_player": game.current_turn_player(),
        "eliminated": list(game.eliminated),
        "finished": game.finished,
        "winner": game.winner,
        "turn_deadline": session.turn_deadline,
        "asked_this_turn": game.asked_this_turn,
    }


async def _turn_timer_loop(
    code: str,
    session: OrapaMineSession,
    connections: ConnectionManager,
    tasks: dict[str, asyncio.Task],
) -> None:
    """Tâche d'arrière-plan (une par salon en cours de partie chronométrée) :
    force la fin du tour en cours quand `session.turn_deadline` expire
    sans action du joueur, et diffuse l'état à jour. Sonde plutôt que de
    programmer un réveil unique (voir `_TURN_TIMER_POLL_SECONDS`) : le
    délai peut être repoussé à chaque action de jeu, une simple
    re-vérification périodique évite d'avoir à annuler/reprogrammer un
    minuteur à chaque coup. S'arrête d'elle-même une fois la partie
    terminée, et se retire alors de `tasks`."""
    try:
        while True:
            if session.room.status == RoomStatus.FINISHED:
                return
            deadline = session.turn_deadline
            if deadline is None:
                # Pas de tour chronométré pour l'instant (salon à un seul
                # joueur, ou entre deux parties) : ré-essaie plus tard,
                # au cas où un autre joueur rejoindrait entre-temps.
                await asyncio.sleep(_TURN_TIMER_POLL_SECONDS)
                continue
            remaining = deadline - time.time()
            if remaining > 0:
                await asyncio.sleep(min(remaining, _TURN_TIMER_POLL_SECONDS))
                continue
            player = session.current_player_id
            if player is None:
                session.turn_deadline = None
                continue
            try:
                session.end_turn(player)
            except Exception:
                # Ne devrait pas arriver (le joueur courant a toujours le
                # droit de terminer son tour) — coupe le chrono plutôt
                # que de boucler indéfiniment sur la même échéance
                # dépassée.
                session.turn_deadline = None
                continue
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})
    finally:
        tasks.pop(code, None)


def _ensure_timer_task(app, code: str, session: OrapaMineSession, connections: ConnectionManager) -> None:
    """Démarre la boucle de chrono du salon `code` si elle ne tourne pas
    déjà — appelé à chaque transition vers PLAYING (voir `room_socket`/
    `_handle_message`), idempotent."""
    tasks: dict[str, asyncio.Task] = app.state.timer_tasks
    existing = tasks.get(code)
    if existing is not None and not existing.done():
        return
    tasks[code] = asyncio.create_task(_turn_timer_loop(code, session, connections, tasks))


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
            _ensure_timer_task(app, code, session, connections)

    try:
        while True:
            message = await websocket.receive_json()
            await _handle_message(app, code, player.id, session, room, connections, message)
    except WebSocketDisconnect:
        pass
    finally:
        connections.remove(code, player.id)
        room.remove_player(player.id)
        await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})


async def _handle_message(
    app,
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
            # Description complète de la pièce, pas juste sa position
            # (voir la docstring de `OrapaMineSession.remove_piece`) : un
            # retrait par simple position pouvait échouer à tort selon la
            # rotation/le miroir de la pièce.
            piece = piece_from_payload(message["piece"])
            session.remove_piece(player_id, piece)
            await connections.send_to(code, player_id, {"type": "placement_ack", "removed": message["piece"]})

        elif msg_type == "validate_placement":
            all_ready = session.validate_placement(player_id)
            # "prêt" est public (sans révéler le plateau), utile pour un
            # écran d'attente "en attente de l'adversaire".
            await connections.broadcast(code, {"type": "player_ready", "player_id": player_id})
            if all_ready:
                await connections.broadcast(code, {"type": "room_update", "room": room_payload(room)})
                await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})
                _ensure_timer_task(app, code, session, connections)

        elif msg_type == "end_turn":
            # Bouton "Terminer mon tour" (retour utilisateur direct) :
            # même effet que l'expiration du chrono (voir
            # `_turn_timer_loop`), déclenché volontairement.
            session.end_turn(player_id)
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

        elif msg_type == "ask_ray":
            result = session.ask_ray(player_id, message["entry_label"])
            payload = {"type": "ray_result", "entry_label": message["entry_label"], "result": ray_result_payload(result)}
            # Duel : réponse privée au demandeur. Fouille : visible de
            # tous (variante officielle tour par tour) — y compris en
            # solo, où ça ne concerne qu'un seul destinataire.
            if room.mode == RoomMode.FOUILLE:
                await connections.broadcast(code, {**payload, "player_id": player_id})
            else:
                await connections.send_to(code, player_id, payload)
            await connections.broadcast(code, {"type": "game_state", **game_state_payload(session)})

        elif msg_type == "ask_peek":
            result = session.ask_peek(player_id, tuple(message["position"]))
            payload = {"type": "peek_result", "position": message["position"], "result": result}
            if room.mode == RoomMode.FOUILLE:
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
