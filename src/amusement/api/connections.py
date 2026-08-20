"""Suivi des connexions WebSocket actives, par salon puis par joueur —
pour pouvoir répondre à un joueur précis ou diffuser à tout le salon."""

from __future__ import annotations

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}

    def add(self, room_code: str, player_id: str, websocket: WebSocket) -> None:
        self._connections.setdefault(room_code, {})[player_id] = websocket

    def remove(self, room_code: str, player_id: str) -> None:
        self._connections.get(room_code, {}).pop(player_id, None)
        if not self._connections.get(room_code):
            self._connections.pop(room_code, None)

    async def send_to(self, room_code: str, player_id: str, message: dict) -> None:
        websocket = self._connections.get(room_code, {}).get(player_id)
        if websocket is not None:
            await websocket.send_json(message)

    async def broadcast(self, room_code: str, message: dict, exclude: str | None = None) -> None:
        for player_id, websocket in list(self._connections.get(room_code, {}).items()):
            if player_id != exclude:
                await websocket.send_json(message)
