import pytest

from amusement.rooms.manager import RoomManager
from amusement.rooms.room import RoomError, RoomMode


def test_create_room_returns_a_findable_room() -> None:
    manager = RoomManager()
    room = manager.create_room("orapa_mine", RoomMode.DUEL, max_players=2)
    assert manager.get(room.code) is room


def test_get_is_case_insensitive() -> None:
    manager = RoomManager()
    room = manager.create_room("orapa_mine", RoomMode.DUEL, max_players=2)
    assert manager.get(room.code.lower()) is room


def test_get_unknown_room_raises() -> None:
    manager = RoomManager()
    with pytest.raises(RoomError):
        manager.get("ZZZZZ")


def test_remove_makes_room_unfindable() -> None:
    manager = RoomManager()
    room = manager.create_room("orapa_mine", RoomMode.DUEL, max_players=2)
    manager.remove(room.code)
    with pytest.raises(RoomError):
        manager.get(room.code)
