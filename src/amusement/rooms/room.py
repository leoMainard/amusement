"""Salon multijoueur générique (par lien, sans compte — v1).

Un salon regroupe des joueurs autour d'une partie d'un jeu donné. Cette
version ne connaît qu'Orapa Mine, mais la structure (code court,
statut, liste de joueurs) est pensée pour être réutilisée par de futurs
jeux (voir docs/plan.md, portail multi-jeux).
"""

from __future__ import annotations

import secrets
import string
from dataclasses import dataclass, field
from enum import Enum, auto

# Alphabet du code de salon : évite les caractères ambigus à l'oral/à
# l'écrit quand on le partage entre amis (0/O, 1/I).
_ROOM_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0O1I")


def generate_code(length: int = 5) -> str:
    return "".join(secrets.choice(_ROOM_CODE_ALPHABET) for _ in range(length))


class RoomError(RuntimeError):
    """Levée pour toute opération de salon invalide (complet, déjà démarré...)."""


class RoomStatus(Enum):
    LOBBY = auto()  # en attente de joueurs
    PLACING = auto()  # phase de placement des pièces (Duel uniquement)
    PLAYING = auto()  # partie en cours (prospection)
    FINISHED = auto()


class RoomMode(Enum):
    DUEL = auto()
    FOUILLE = auto()  # plateau généré aléatoirement, tour par tour ; jouable seul ou à plusieurs


@dataclass
class Player:
    id: str  # identifiant de session, généré côté serveur
    name: str


@dataclass
class Room:
    code: str
    game: str  # "orapa_mine" pour l'instant — voir docs/plan.md (portail multi-jeux)
    mode: RoomMode
    max_players: int
    # Fixé à la création du salon, pour que tous les joueurs jouent avec
    # les mêmes pièces disponibles (sinon un joueur pourrait poser le
    # Diamant/Corps noir en Duel pendant que l'autre s'en tient aux 5 de
    # base — retour utilisateur direct sur ce point).
    extensions_enabled: bool = False
    players: list[Player] = field(default_factory=list)
    status: RoomStatus = RoomStatus.LOBBY

    def __post_init__(self) -> None:
        if self.mode == RoomMode.DUEL and self.max_players != 2:
            raise RoomError("Le mode Duel se joue exactement à 2.")
        if self.mode == RoomMode.FOUILLE and self.max_players < 1:
            raise RoomError("Il faut au moins 1 joueur.")

    def add_player(self, name: str) -> Player:
        if self.status != RoomStatus.LOBBY:
            raise RoomError("La partie a déjà commencé : impossible de rejoindre.")
        if self.is_full():
            raise RoomError("Le salon est complet.")
        player = Player(id=generate_code(10), name=name)
        self.players.append(player)
        return player

    def remove_player(self, player_id: str) -> None:
        self.players = [p for p in self.players if p.id != player_id]

    def is_full(self) -> bool:
        return len(self.players) >= self.max_players
