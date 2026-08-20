"""Relie un `Room` au moteur de jeu Orapa Mine (DuelGame / FouilleGame),
et traduit les messages WebSocket (dicts JSON) en appels au moteur.

Reste volontairement séparé de la couche transport (`game_ws.py`) pour
rester testable sans WebSocket réel.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from amusement.engine.orapa_mine import (
    BASE_PIECE_SET,
    EXTENSION_PIECE_SET,
    Board,
    BoardDimensions,
    Color,
    DuelGame,
    FouilleGame,
    FouilleMode,
    GemKind,
    LabelScheme,
    Piece,
    PieceShape,
    Position,
    random_board,
)
from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus


def piece_from_payload(payload: dict) -> Piece:
    try:
        shape = PieceShape[payload["shape"]]
        kind = GemKind[payload.get("kind", "NORMAL")]
        color = Color[payload["color"]] if payload.get("color") else None
        origin = tuple(payload["origin"])
        rotation_steps = int(payload.get("rotation_steps", 0))
        mirrored = bool(payload.get("mirrored", False))
    except (KeyError, ValueError, TypeError) as exc:
        raise RoomError(f"Pièce invalide : {exc}") from exc
    return Piece(shape=shape, kind=kind, color=color, origin=origin, rotation_steps=rotation_steps, mirrored=mirrored)


def piece_to_payload(piece: Piece) -> dict:
    return {
        "shape": piece.shape.name,
        "kind": piece.kind.name,
        "color": piece.color.name if piece.color else None,
        "origin": list(piece.origin),
        "rotation_steps": piece.rotation_steps,
        "mirrored": piece.mirrored,
    }


def _piece_key(piece: Piece) -> tuple:
    # `kind` doit faire partie de la clé : le Diamant et le Corps noir
    # ont tous deux `shape=TENT` et `color=None`, donc (shape, color)
    # seul les confondrait — poser l'un rendrait l'autre injustement
    # "déjà posé".
    return (piece.shape, piece.kind, piece.color)


@dataclass
class PendingPlacement:
    """Plateau en cours de constitution par un joueur, en mode Duel,
    avant validation (voir `OrapaMineSession.place_piece`)."""

    board: Board
    used: set[tuple] = field(default_factory=set)
    ready: bool = False


class OrapaMineSession:
    """État de partie associé à un salon Orapa Mine."""

    def __init__(self, room: Room, dimensions: BoardDimensions | None = None) -> None:
        self.room = room
        self.dimensions = dimensions or BoardDimensions()
        self.label_scheme = LabelScheme(self.dimensions)
        self.placements: dict[str, PendingPlacement] = {}
        self.duel: DuelGame | None = None
        self.fouille: FouilleGame | None = None

    # --- démarrage, selon le mode du salon --------------------------------

    def start(self) -> None:
        """Appelé quand le salon est complet : lance la phase adaptée."""
        if self.room.mode == RoomMode.DUEL:
            self.placements = {p.id: PendingPlacement(board=Board(self.dimensions)) for p in self.room.players}
            self.room.status = RoomStatus.PLACING
        else:
            fouille_mode = FouilleMode.TURN_BASED if self.room.mode == RoomMode.FOUILLE_TURN_BASED else FouilleMode.PARALLEL_PRIVATE
            pieces = BASE_PIECE_SET + EXTENSION_PIECE_SET if self.room.extensions_enabled else BASE_PIECE_SET
            board = random_board(self.dimensions, pieces)
            players = tuple(p.id for p in self.room.players)
            self.fouille = FouilleGame(board=board, players=players, mode=fouille_mode, label_scheme=self.label_scheme)
            self.room.status = RoomStatus.PLAYING

    # --- Duel : placement ---------------------------------------------------

    def place_piece(self, player_id: str, piece: Piece) -> None:
        pending = self._pending_for(player_id)
        if piece.kind != GemKind.NORMAL and not self.room.extensions_enabled:
            raise RoomError("Les pièces d'extension (Diamant, Corps noir) ne sont pas activées pour ce salon.")
        key = _piece_key(piece)
        if key in pending.used:
            raise RoomError("Cette pièce a déjà été posée.")
        pending.board.place_piece(piece)  # peut lever PlacementError
        pending.used.add(key)

    def remove_piece_at(self, player_id: str, position: Position) -> None:
        pending = self._pending_for(player_id)
        piece = pending.board.piece_at_cell(tuple(position))
        if piece is None:
            raise RoomError("Aucune pièce à cet endroit.")
        pending.board.remove_piece(piece)
        pending.used.discard(_piece_key(piece))

    def validate_placement(self, player_id: str) -> bool:
        """Renvoie True si tous les joueurs sont prêts (la partie démarre)."""
        pending = self._pending_for(player_id)
        if len(pending.used) < len(BASE_PIECE_SET):
            raise RoomError(f"Placement incomplet ({len(pending.used)}/{len(BASE_PIECE_SET)} pièces).")
        pending.ready = True
        if all(p.ready for p in self.placements.values()):
            self._start_duel()
            return True
        return False

    def _pending_for(self, player_id: str) -> PendingPlacement:
        if self.room.status != RoomStatus.PLACING:
            raise RoomError("Ce n'est pas la phase de placement.")
        pending = self.placements.get(player_id)
        if pending is None:
            raise RoomError("Joueur inconnu pour ce salon.")
        if pending.ready:
            raise RoomError("Placement déjà validé : plus de modification possible.")
        return pending

    def _start_duel(self) -> None:
        players = tuple(p.id for p in self.room.players)
        boards = {pid: pending.board for pid, pending in self.placements.items()}
        starting_player = players[0]  # ordre d'arrivée — tirage au sort réel à ajouter côté UI
        self.duel = DuelGame(players=players, boards=boards, starting_player=starting_player, label_scheme=self.label_scheme)
        self.room.status = RoomStatus.PLAYING

    # --- jeu : questions/réponses, commun aux deux modes ---------------------

    @property
    def _active_game(self) -> DuelGame | FouilleGame:
        game = self.duel if self.room.mode == RoomMode.DUEL else self.fouille
        if game is None:
            raise RoomError("La partie n'a pas encore démarré.")
        return game

    def ask_ray(self, player_id: str, entry_label: str):
        return self._active_game.ask_ray(player_id, entry_label)

    def ask_peek(self, player_id: str, position: Position) -> str:
        return self._active_game.ask_peek(player_id, tuple(position))

    def submit_solution(self, player_id: str, guess_payload: list[dict]) -> None:
        guess = [piece_from_payload(p) for p in guess_payload]
        self._active_game.submit_solution(player_id, guess)
        if self._active_game.finished:
            self.room.status = RoomStatus.FINISHED
