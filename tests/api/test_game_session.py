import pytest

from amusement.api.game_session import OrapaMineSession, piece_from_payload, piece_to_payload
from amusement.engine.orapa_mine import BoardDimensions, Piece
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
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.add_player("Bob")
    session = OrapaMineSession(room)
    session.start()
    session.place_piece(alice.id, Piece.diamond(origin=(0, 0)))
    session.place_piece(alice.id, Piece.black_body(origin=(2, 2)))  # ne doit pas lever RoomError
    assert len(session.placements[alice.id].board.pieces()) == 2


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
    session.place_piece(alice.id, Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))
    session.remove_piece_at(alice.id, (0, 0))
    assert session.placements[alice.id].used == set()
    # La replacer doit fonctionner (le "used" a bien été libéré).
    session.place_piece(alice.id, Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))


def test_fouille_full_flow() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE_PARALLEL, max_players=2)
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
