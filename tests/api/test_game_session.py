import time

import pytest

from amusement.api.game_session import OrapaMineSession, piece_from_payload, piece_to_payload
from amusement.engine.orapa_mine import BoardDimensions, GemKind, Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.fouille import FouilleError
from amusement.engine.orapa_mine.pieces import PieceShape
from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus


def base_pieces_payload() -> list[dict]:
    """Un placement complet valide (5 pièces, bien espacées) pour les tests."""
    pieces = [
        Piece.normal(PieceShape.PARALLELOGRAM, Color.RED, origin=(0, 0)),
        Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(4, 0)),
        Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(0, 4)),
        Piece.normal(PieceShape.LARGE_TRIANGLE, Color.BLUE, origin=(4, 4)),
        Piece.normal(PieceShape.LARGE_TRIANGLE, Color.WHITE, origin=(6, 0)),
    ]
    return [piece_to_payload(p) for p in pieces]


def test_piece_payload_round_trip() -> None:
    piece = Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(2, 3), rotation_steps=2, mirrored=True)
    assert piece_from_payload(piece_to_payload(piece)) == piece


def test_duel_full_flow() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert room.status == RoomStatus.PLACING

    payload = base_pieces_payload()
    for entry in payload:
        session.place_piece(alice.id, piece_from_payload(entry))
        session.place_piece(bob.id, piece_from_payload(entry))

    assert session.validate_placement(alice.id) is False  # bob pas encore prêt
    assert session.validate_placement(bob.id) is True  # les deux sont prêts
    assert room.status == RoomStatus.PLAYING
    assert session.duel is not None
    assert session.duel.current_prospector == alice.id

    result = session.ask_peek(alice.id, (0, 0))
    assert result == "Une gemme rouge"


def test_place_piece_before_start_raises() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    with pytest.raises(RoomError):
        session.place_piece(alice.id, Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))


def test_diamond_and_black_body_are_tracked_separately() -> None:
    # Bug corrigé : les deux ont shape=TENT et color=None, donc poser
    # l'un ne doit pas rendre l'autre injustement "déjà posé".
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2, extensions_enabled=True)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    session.place_piece(alice.id, Piece.diamond(origin=(0, 0)))
    session.place_piece(alice.id, Piece.black_body(origin=(2, 2)))  # ne doit pas lever RoomError
    assert len(session.placements[alice.id].board.pieces()) == 2


def test_extension_pieces_rejected_when_room_has_them_disabled() -> None:
    # Le point soulevé par l'utilisateur : sans ce garde-fou, un joueur
    # pourrait poser le Diamant/Corps noir pendant que l'autre s'en tient
    # aux 5 gemmes de base — les deux joueurs doivent être sur la même
    # longueur d'onde, fixée une fois pour tout le salon.
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2, extensions_enabled=False)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    with pytest.raises(RoomError):
        session.place_piece(alice.id, Piece.diamond(origin=(0, 0)))


def test_extension_pieces_allowed_when_room_has_them_enabled() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2, extensions_enabled=True)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    session.place_piece(alice.id, Piece.diamond(origin=(0, 0)))  # ne doit pas lever
    assert len(session.placements[alice.id].board.pieces()) == 1


def test_fouille_board_includes_extensions_when_room_has_them_enabled() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2, extensions_enabled=True)
    room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    kinds = {p.kind for p in session.fouille.board.pieces()}
    assert GemKind.DIAMOND in kinds
    assert GemKind.BLACK_BODY in kinds


def test_fouille_board_excludes_extensions_when_room_has_them_disabled() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2, extensions_enabled=False)
    room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    kinds = {p.kind for p in session.fouille.board.pieces()}
    assert GemKind.DIAMOND not in kinds
    assert GemKind.BLACK_BODY not in kinds


def test_cannot_validate_incomplete_placement() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    session.place_piece(alice.id, Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))
    with pytest.raises(RoomError):
        session.validate_placement(alice.id)


def test_remove_piece_before_validating() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    piece = Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))
    session.place_piece(alice.id, piece)
    session.remove_piece(alice.id, piece)
    assert session.placements[alice.id].used == set()
    # La replacer doit fonctionner (le "used" a bien été libéré).
    session.place_piece(alice.id, piece)


def test_remove_piece_matches_by_full_description_not_just_position() -> None:
    # "Au hasard" tire des rotations/miroirs aléatoires bien plus souvent
    # qu'un placement manuel (retour utilisateur direct) : `origin`
    # marque le coin de la boîte englobante d'une pièce, pas forcément
    # une case qu'elle occupe réellement une fois tournée/retournée — un
    # retrait par simple position pouvait donc échouer à tort avec
    # « Aucune pièce à cet endroit » pour certaines orientations. La
    # correspondance par description complète (forme/couleur/origine/
    # rotation/miroir) élimine ce problème de géométrie entièrement.
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    for rotation_steps in range(4):
        for mirrored in (False, True):
            piece = Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4), rotation_steps=rotation_steps, mirrored=mirrored)
            session.place_piece(alice.id, piece)
            session.remove_piece(alice.id, piece)
            assert session.placements[alice.id].used == set()


def test_remove_piece_not_present_raises() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    with pytest.raises(RoomError):
        session.remove_piece(alice.id, Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))


def test_fouille_full_flow() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert room.status == RoomStatus.PLAYING
    assert session.fouille is not None

    correct_guess = [piece_to_payload(p) for p in session.fouille.board.pieces()]
    session.submit_solution(alice.id, correct_guess)
    assert session.fouille.finished
    assert session.fouille.winner == alice.id
    assert room.status == RoomStatus.FINISHED

    # La partie est terminée : plus aucune question n'est possible, pour
    # personne (l'exception vient directement du moteur, voir fouille.py).
    with pytest.raises(FouilleError):
        session.ask_peek(bob.id, (0, 0))


def test_fouille_solo_flow() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=1)
    solo = room.add_player("Solo")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert room.status == RoomStatus.PLAYING
    assert session.fouille is not None
    assert session.fouille.current_turn_player() == solo.id

    session.ask_peek(solo.id, (0, 0))
    correct_guess = [piece_to_payload(p) for p in session.fouille.board.pieces()]
    session.submit_solution(solo.id, correct_guess)
    assert session.fouille.finished
    assert session.fouille.winner == solo.id


# --- Chrono de tour (4 min, "lorsqu'il y a plusieurs joueurs") -----------


def test_turn_deadline_starts_when_fouille_multiplayer_begins() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9), turn_duration_seconds=240.0)
    before = time.time()
    session.start()
    assert session.turn_deadline is not None
    assert before + 239 <= session.turn_deadline <= before + 241


def test_turn_deadline_absent_for_fouille_solo() -> None:
    # "lorsqu'il y a plusieurs joueurs" (retour utilisateur direct) :
    # personne à presser tout seul.
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=1)
    room.add_player("Solo")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert session.turn_deadline is None


def test_turn_deadline_starts_when_duel_placement_completes() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert session.turn_deadline is None  # encore en PLACING

    for entry in base_pieces_payload():
        session.place_piece(alice.id, piece_from_payload(entry))
        session.place_piece(bob.id, piece_from_payload(entry))
    session.validate_placement(alice.id)
    session.validate_placement(bob.id)
    assert room.status == RoomStatus.PLAYING
    assert session.turn_deadline is not None


def test_asking_a_question_does_not_reset_the_turn_timer() -> None:
    # Un tour reste une fenêtre de temps FIXE : poser une question ne la
    # prolonge pas (retour utilisateur direct — sinon enchaîner les
    # questions permettrait de ne jamais voir son tour expirer).
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9), turn_duration_seconds=240.0)
    session.start()
    session.turn_deadline = time.time() + 1  # simule un tour presque écoulé
    almost_expired = session.turn_deadline
    session.ask_peek(alice.id, (0, 0))
    assert session.turn_deadline == almost_expired


def test_end_turn_resets_the_turn_timer() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9), turn_duration_seconds=240.0)
    session.start()
    first_deadline = session.turn_deadline
    session.turn_deadline = time.time() + 1  # simule un tour presque écoulé
    session.end_turn(alice.id)
    # `end_turn` (bouton "Terminer mon tour"/expiration du chrono), lui,
    # relance bien le chrono complet pour le tour suivant.
    assert session.turn_deadline > first_deadline - 1


def test_turn_deadline_cleared_once_game_finished() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert session.turn_deadline is not None
    correct_guess = [piece_to_payload(p) for p in session.fouille.board.pieces()]
    session.submit_solution(alice.id, correct_guess)
    assert session.fouille.finished
    assert session.turn_deadline is None


def test_end_turn_hands_off_in_fouille() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    assert session.current_player_id == alice.id
    session.end_turn(alice.id)
    assert session.current_player_id == bob.id
    assert session.turn_deadline is not None  # rechronométré pour le tour suivant


def test_end_turn_hands_off_in_duel() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    for entry in base_pieces_payload():
        session.place_piece(alice.id, piece_from_payload(entry))
        session.place_piece(bob.id, piece_from_payload(entry))
    session.validate_placement(alice.id)
    session.validate_placement(bob.id)
    assert session.current_player_id == alice.id
    session.end_turn(alice.id)
    assert session.current_player_id == bob.id


def test_end_turn_out_of_turn_raises() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    session = OrapaMineSession(room, BoardDimensions(width=9, height=9))
    session.start()
    with pytest.raises(FouilleError):
        session.end_turn(bob.id)


def test_end_turn_before_game_starts_raises() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    with pytest.raises(RoomError):
        session.end_turn(alice.id)


def test_current_player_id_none_before_game_starts() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    assert session.current_player_id is None
