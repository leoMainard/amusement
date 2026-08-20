import pytest

from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus, generate_code


def test_generate_code_avoids_ambiguous_characters() -> None:
    codes = {generate_code() for _ in range(200)}
    combined = "".join(codes)
    assert not any(c in combined for c in "0O1I")


def test_duel_room_requires_exactly_two_players() -> None:
    with pytest.raises(RoomError):
        Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=3)


def test_add_player_until_full() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    bob = room.add_player("Bob")
    assert alice.id != bob.id
    assert room.is_full()
    with pytest.raises(RoomError):
        room.add_player("Charlie")


def test_cannot_join_once_started() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=3)
    room.add_player("Alice")
    room.status = RoomStatus.PLAYING
    with pytest.raises(RoomError):
        room.add_player("Bob")


def test_remove_player_frees_a_slot_conceptually() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.DUEL, max_players=2)
    alice = room.add_player("Alice")
    room.remove_player(alice.id)
    assert room.players == []


def test_fouille_room_allows_a_single_player() -> None:
    room = Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=1)
    alice = room.add_player("Alice")
    assert room.is_full()
    assert room.players == [alice]


def test_fouille_room_rejects_zero_players() -> None:
    with pytest.raises(RoomError):
        Room(code="ABCDE", game="orapa_mine", mode=RoomMode.FOUILLE, max_players=0)
