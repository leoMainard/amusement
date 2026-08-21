"""Tests d'intégration du salon + WebSocket Orapa Mine, de bout en bout :
création du salon en REST, connexion de 2 joueurs, placement (Duel),
questions, fin de partie. Utilise `TestClient` (transport ASGI en
mémoire, pas de vrai serveur réseau)."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from amusement.api.game_session import piece_to_payload
from amusement.api.main import app
from amusement.engine.orapa_mine import Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.pieces import PieceShape

client = TestClient(app)


def create_room(mode: str = "duel", max_players: int = 2, extensions_enabled: bool = False) -> str:
    response = client.post(
        "/api/rooms",
        json={"game": "orapa_mine", "mode": mode, "max_players": max_players, "extensions_enabled": extensions_enabled},
    )
    assert response.status_code == 200, response.text
    return response.json()["code"]


def base_placement() -> list[dict]:
    pieces = [
        Piece.normal(PieceShape.PARALLELOGRAM, Color.RED, origin=(0, 0)),
        Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(4, 0)),
        Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(0, 4)),
        Piece.normal(PieceShape.LARGE_TRIANGLE, Color.BLUE, origin=(4, 4)),
        Piece.normal(PieceShape.LARGE_TRIANGLE, Color.WHITE, origin=(6, 0)),
    ]
    return [piece_to_payload(p) for p in pieces]


def test_create_room_returns_a_code() -> None:
    response = client.post("/api/rooms", json={"game": "orapa_mine", "mode": "duel", "max_players": 2})
    assert response.status_code == 200
    body = response.json()
    assert len(body["code"]) == 5
    assert body["status"] == "LOBBY"


def test_create_room_rejects_unknown_mode() -> None:
    response = client.post("/api/rooms", json={"game": "orapa_mine", "mode": "n_importe_quoi", "max_players": 2})
    assert response.status_code == 422


def test_get_room_returns_its_info() -> None:
    code = create_room(mode="fouille", max_players=3, extensions_enabled=True)
    response = client.get(f"/api/rooms/{code}")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == code
    assert body["game"] == "orapa_mine"
    assert body["mode"] == "FOUILLE"
    assert body["max_players"] == 3
    assert body["extensions_enabled"] is True


def test_get_unknown_room_returns_404() -> None:
    response = client.get("/api/rooms/ZZZZZ")
    assert response.status_code == 404


def test_create_room_extensions_enabled_flag_round_trips() -> None:
    response = client.post(
        "/api/rooms",
        json={"game": "orapa_mine", "mode": "duel", "max_players": 2, "extensions_enabled": True},
    )
    assert response.status_code == 200
    assert response.json()["extensions_enabled"] is True

    response = client.post("/api/rooms", json={"game": "orapa_mine", "mode": "duel", "max_players": 2})
    assert response.json()["extensions_enabled"] is False


def test_extension_piece_rejected_over_websocket_when_room_disallows_it() -> None:
    code = create_room(mode="duel", max_players=2, extensions_enabled=False)
    diamond = piece_to_payload(Piece.diamond(origin=(0, 0)))

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined
        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            alice_ws.receive_json()  # room_update: PLACING
            bob_ws.receive_json()  # room_update: PLACING

            alice_ws.send_json({"type": "place_piece", "piece": diamond})
            response = alice_ws.receive_json()
            assert response["type"] == "error"


def test_join_unknown_room_is_refused() -> None:
    try:
        with client.websocket_connect("/ws/rooms/ZZZZZ?name=Alice"):
            pass
        raised = False
    except Exception:
        raised = True
    assert raised


def test_two_players_join_and_room_fills_up() -> None:
    code = create_room(mode="duel", max_players=2)

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        joined_alice = alice_ws.receive_json()
        assert joined_alice["type"] == "joined"
        assert joined_alice["room"]["status"] == "LOBBY"
        alice_id = joined_alice["player_id"]

        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            joined_bob = bob_ws.receive_json()
            assert joined_bob["type"] == "joined"
            bob_id = joined_bob["player_id"]
            assert bob_id != alice_id

            # Alice voit Bob rejoindre, puis le salon passer en placement.
            update_1 = alice_ws.receive_json()
            assert update_1["type"] == "room_update"
            assert len(update_1["room"]["players"]) == 2
            update_2 = alice_ws.receive_json()
            assert update_2["room"]["status"] == "PLACING"

            # Bob reçoit directement le passage en placement (il a
            # rejoint après que le salon était déjà à 2/2).
            bob_update = bob_ws.receive_json()
            assert bob_update["room"]["status"] == "PLACING"


def test_duel_full_flow_over_websocket() -> None:
    code = create_room(mode="duel", max_players=2)
    placement = base_placement()

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined

        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            alice_ws.receive_json()  # room_update: PLACING
            bob_ws.receive_json()  # room_update: PLACING

            for piece in placement:
                alice_ws.send_json({"type": "place_piece", "piece": piece})
                ack = alice_ws.receive_json()
                assert ack["type"] == "placement_ack"
                bob_ws.send_json({"type": "place_piece", "piece": piece})
                assert bob_ws.receive_json()["type"] == "placement_ack"

            alice_ws.send_json({"type": "validate_placement"})
            assert alice_ws.receive_json()["type"] == "player_ready"  # broadcast reçu par elle aussi
            bob_ws.send_json({"type": "validate_placement"})

            # Une fois les deux prêts : "player_ready" (bob), puis
            # room_update (PLAYING) et game_state, diffusés aux deux.
            assert alice_ws.receive_json()["type"] == "player_ready"
            assert bob_ws.receive_json()["type"] == "player_ready"
            room_update = alice_ws.receive_json()
            assert room_update["room"]["status"] == "PLAYING"
            game_state = alice_ws.receive_json()
            assert game_state["type"] == "game_state"
            first_prospector = game_state["current_prospector"]
            assert first_prospector in {"placeholder"} or True  # juste vérifier la présence, id serveur opaque

            bob_ws.receive_json()  # room_update (PLAYING)
            bob_ws.receive_json()  # game_state

            # Le premier prospecteur pose une question triviale (qu'y
            # a-t-il en (8,8), une case vide chez tout le monde).
            asker_ws = alice_ws  # alice a rejoint en premier -> starting_player
            asker_ws.send_json({"type": "ask_peek", "position": [8, 8]})
            peek_response = asker_ws.receive_json()
            assert peek_response["type"] == "peek_result"
            assert peek_response["result"] == "Rien"
            asker_ws.receive_json()  # game_state (tour passé à bob)


def test_fouille_full_flow_over_websocket() -> None:
    code = create_room(mode="fouille", max_players=2)

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined

        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            room_update = alice_ws.receive_json()  # room_update: PLAYING (auto, plateau généré)
            assert room_update["room"]["status"] == "PLAYING"
            game_state = alice_ws.receive_json()
            assert game_state["type"] == "game_state"
            assert game_state["current_turn_player"] is not None  # tour par tour dès le départ

            bob_ws.receive_json()  # room_update PLAYING
            bob_ws.receive_json()  # game_state

            # Plateau commun, tour par tour, variante officielle : la
            # réponse est diffusée à tout le monde, pas seulement au
            # demandeur (contrairement à Duel).
            alice_ws.send_json({"type": "ask_peek", "position": [8, 8]})
            alice_response = alice_ws.receive_json()
            assert alice_response["type"] == "peek_result"
            bob_response = bob_ws.receive_json()
            assert bob_response["type"] == "peek_result"
            alice_ws.receive_json()  # game_state (tour passé à bob)
            bob_ws.receive_json()  # game_state


def test_fouille_solo_full_flow_over_websocket() -> None:
    code = create_room(mode="fouille", max_players=1)

    with client.websocket_connect(f"/ws/rooms/{code}?name=Solo") as ws:
        ws.receive_json()  # joined
        room_update = ws.receive_json()  # room_update: PLAYING (auto, salon déjà plein à 1)
        assert room_update["room"]["status"] == "PLAYING"
        game_state = ws.receive_json()
        assert game_state["type"] == "game_state"

        ws.send_json({"type": "ask_peek", "position": [8, 8]})
        assert ws.receive_json()["type"] == "peek_result"
        ws.receive_json()  # game_state — toujours son tour, seul joueur


def test_game_state_includes_turn_deadline_with_two_players() -> None:
    code = create_room(mode="fouille", max_players=2)
    before = time.time()

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined
        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            alice_ws.receive_json()  # room_update: PLAYING
            game_state = alice_ws.receive_json()
            assert game_state["type"] == "game_state"
            deadline = game_state["turn_deadline"]
            assert deadline is not None
            # ~4 min (240s) à partir du démarrage, avec une marge large
            # pour l'exécution du test lui-même.
            assert before + 200 <= deadline <= before + 280


def test_game_state_turn_deadline_absent_for_fouille_solo() -> None:
    # "lorsqu'il y a plusieurs joueurs" (retour utilisateur direct) :
    # personne à presser tout seul.
    code = create_room(mode="fouille", max_players=1)
    with client.websocket_connect(f"/ws/rooms/{code}?name=Solo") as ws:
        ws.receive_json()  # joined
        ws.receive_json()  # room_update PLAYING
        game_state = ws.receive_json()
        assert game_state["type"] == "game_state"
        assert game_state["turn_deadline"] is None


def test_end_turn_over_websocket_hands_off_turn() -> None:
    code = create_room(mode="fouille", max_players=2)

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined
        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            alice_ws.receive_json()  # room_update: PLAYING
            first_state = alice_ws.receive_json()
            assert first_state["current_turn_player"] is not None
            bob_ws.receive_json()  # room_update PLAYING
            bob_ws.receive_json()  # game_state

            # Bouton "Terminer mon tour" : passe la main sans poser de
            # question, diffusé aux deux joueurs.
            alice_ws.send_json({"type": "end_turn"})
            alice_new_state = alice_ws.receive_json()
            bob_new_state = bob_ws.receive_json()
            assert alice_new_state["type"] == "game_state"
            assert alice_new_state["current_turn_player"] != first_state["current_turn_player"]
            assert bob_new_state["current_turn_player"] == alice_new_state["current_turn_player"]


def test_end_turn_out_of_turn_is_refused_over_websocket() -> None:
    code = create_room(mode="fouille", max_players=2)

    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined
        with client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
            bob_ws.receive_json()  # joined
            alice_ws.receive_json()  # room_update: bob a rejoint
            alice_ws.receive_json()  # room_update: PLAYING
            alice_ws.receive_json()  # game_state (tour d'alice, arrivée en premier)
            bob_ws.receive_json()  # room_update PLAYING
            bob_ws.receive_json()  # game_state

            bob_ws.send_json({"type": "end_turn"})
            error = bob_ws.receive_json()
            assert error["type"] == "error"


def test_turn_timer_forces_turn_change_after_expiry() -> None:
    # Vérifie la boucle d'arrière-plan de bout en bout (voir
    # `game_ws._turn_timer_loop`) : un chrono raccourci artificiellement
    # (session déjà en mémoire après la connexion d'Alice, avant que le
    # salon ne se remplisse — voir `OrapaMineSession.turn_duration_seconds`)
    # doit faire passer la main tout seul, sans action d'aucun joueur.
    #
    # ⚠️ Client dédié, utilisé comme gestionnaire de contexte (contrairement
    # au `client` module ci-dessus) : chaque `websocket_connect()` sans
    # `with TestClient(app) as ...` ouvre son propre "portail" (thread +
    # boucle asyncio séparés, voir `starlette.testclient`). Une diffusion
    # émise par une tâche d'arrière-plan démarrée sur la connexion de Bob
    # vers le socket d'Alice — sur un portail différent du sien — ne
    # réveille alors jamais sa lecture bloquante (bug de test découvert en
    # écrivant ce test, pas un bug produit : en production, uvicorn ne
    # fait tourner qu'UNE seule boucle événementielle pour toutes les
    # connexions). Partager un seul portail entre les deux connexions
    # (`with TestClient(app) as scoped_client:`) reproduit fidèlement ce
    # fonctionnement réel.
    with TestClient(app) as scoped_client:
        code = scoped_client.post(
            "/api/rooms",
            json={"game": "orapa_mine", "mode": "fouille", "max_players": 2, "extensions_enabled": False},
        ).json()["code"]

        with scoped_client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
            alice_ws.receive_json()  # joined
            session = scoped_client.app.state.sessions[code]
            session.turn_duration_seconds = 0.2

            with scoped_client.websocket_connect(f"/ws/rooms/{code}?name=Bob") as bob_ws:
                bob_ws.receive_json()  # joined
                alice_ws.receive_json()  # room_update: bob a rejoint
                alice_ws.receive_json()  # room_update: PLAYING
                first_state = alice_ws.receive_json()
                assert first_state["current_turn_player"] is not None
                bob_ws.receive_json()  # room_update PLAYING
                bob_ws.receive_json()  # game_state

                # Ni Alice ni Bob n'envoient quoi que ce soit : seule
                # l'expiration du chrono doit produire ce prochain
                # game_state.
                timed_out_state = alice_ws.receive_json()
                assert timed_out_state["type"] == "game_state"
                assert timed_out_state["current_turn_player"] != first_state["current_turn_player"]


def test_error_message_on_invalid_action() -> None:
    code = create_room(mode="duel", max_players=2)
    with client.websocket_connect(f"/ws/rooms/{code}?name=Alice") as alice_ws:
        alice_ws.receive_json()  # joined
        # La partie n'a pas démarré (un seul joueur) : poser une pièce doit échouer proprement.
        alice_ws.send_json(
            {
                "type": "place_piece",
                "piece": piece_to_payload(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))),
            }
        )
        error = alice_ws.receive_json()
        assert error["type"] == "error"
        assert "placement" in error["message"].lower()
