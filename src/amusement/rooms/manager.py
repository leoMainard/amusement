"""Registre en mémoire des salons actifs.

Volontairement simple (dict en mémoire, pas de persistance) : cohérent
avec le choix v1 « salons par lien, sans compte » (voir docs/plan.md).
Un redémarrage du serveur efface les salons en cours — acceptable pour
des parties entre amis qui durent quelques minutes.
"""

from __future__ import annotations

from .room import Room, RoomError, RoomMode, generate_code


class RoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def create_room(self, game: str, mode: RoomMode, max_players: int, extensions_enabled: bool = False) -> Room:
        for _ in range(50):
            code = generate_code()
            if code not in self._rooms:
                room = Room(
                    code=code,
                    game=game,
                    mode=mode,
                    max_players=max_players,
                    extensions_enabled=extensions_enabled,
                )
                self._rooms[code] = room
                return room
        raise RuntimeError("Impossible de générer un code de salon unique.")

    def get(self, code: str) -> Room:
        try:
            return self._rooms[code.upper()]
        except KeyError:
            raise RoomError(f"Salon {code!r} introuvable.") from None

    def remove(self, code: str) -> None:
        self._rooms.pop(code.upper(), None)

    def __len__(self) -> int:
        return len(self._rooms)
