"""Plateau et placement des pièces (Orapa Mine).

Révision : une pièce occupe désormais une silhouette réelle à plusieurs
cases (voir `pieces.py`), plus l'ancien modèle « une gemme = une case »
qui ne correspondait pas aux vraies pièces du jeu (voir docs/plan.md).
Le placement est validé au niveau des quartiers de case (`geometry.py`)
pour appliquer exactement les règles du livret :
- (d./e.) deux pièces ne peuvent se toucher que par un point, jamais par
  un bord entier de longueur non nulle ;
- une pièce doit rester entièrement dans les limites du plateau.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto

from .colors import Color
from .geometry import Quadrant, edge_adjacent_neighbors, polygon_to_quadrants
from .pieces import PieceShape, Position, place_shape


class GemKind(Enum):
    NORMAL = auto()
    DIAMOND = auto()  # extension : dévie le rayon sans le teinter
    BLACK_BODY = auto()  # extension : absorbe le rayon


@dataclass(frozen=True)
class BoardDimensions:
    # Hypothèse retenue par défaut (voir docs/plan.md), non confirmée
    # visuellement avec certitude : grille 9x9.
    width: int = 9
    height: int = 9


class PlacementError(ValueError):
    """Levée quand un placement de pièce viole une règle du livret."""


@dataclass(frozen=True)
class Piece:
    """Une pièce posée sur le plateau : sa forme, sa nature/couleur, et
    son placement (origine + rotation + éventuel miroir)."""

    shape: PieceShape
    kind: GemKind = GemKind.NORMAL
    color: Color | None = None
    origin: Position = (0, 0)
    rotation_steps: int = 0  # nombre de rotations de 90°, 0-3
    mirrored: bool = False

    def __post_init__(self) -> None:
        if self.kind == GemKind.NORMAL:
            if self.color is None:
                raise ValueError("Une pièce normale doit avoir une couleur.")
            if self.shape == PieceShape.TENT:
                raise ValueError("La forme TENT est réservée au Diamant et au Corps noir.")
        else:
            if self.color is not None:
                raise ValueError(f"Une pièce de type {self.kind.name} n'a pas de couleur.")
            if self.shape != PieceShape.TENT:
                raise ValueError(
                    f"Une pièce de type {self.kind.name} utilise la forme TENT "
                    "(hypothèse de forme au sol — voir docs/plan.md)."
                )

    def vertices(self) -> list[tuple[int, int]]:
        return place_shape(self.shape, self.origin, self.rotation_steps, self.mirrored)

    def quadrants(self) -> set[tuple[int, int, Quadrant]]:
        return polygon_to_quadrants(self.vertices())

    @staticmethod
    def normal(shape: PieceShape, color: Color, origin: Position, rotation_steps: int = 0, mirrored: bool = False) -> "Piece":
        return Piece(shape=shape, kind=GemKind.NORMAL, color=color, origin=origin, rotation_steps=rotation_steps, mirrored=mirrored)

    @staticmethod
    def diamond(origin: Position) -> "Piece":
        return Piece(shape=PieceShape.TENT, kind=GemKind.DIAMOND, origin=origin)

    @staticmethod
    def black_body(origin: Position) -> "Piece":
        return Piece(shape=PieceShape.TENT, kind=GemKind.BLACK_BODY, origin=origin)


class Board:
    """Le plateau (mine) d'un joueur : une grille et les pièces posées."""

    def __init__(self, dimensions: BoardDimensions | None = None) -> None:
        self.dimensions = dimensions or BoardDimensions()
        self._pieces: list[Piece] = []
        self._occupancy: dict[tuple[int, int, Quadrant], Piece] = {}

    @property
    def width(self) -> int:
        return self.dimensions.width

    @property
    def height(self) -> int:
        return self.dimensions.height

    def contains_cell(self, pos: Position) -> bool:
        col, row = pos
        return 0 <= col < self.width and 0 <= row < self.height

    def pieces(self) -> list[Piece]:
        return list(self._pieces)

    def piece_at_cell(self, pos: Position) -> Piece | None:
        """La pièce présente en `pos`, si une case y a au moins un
        quartier occupé (réponse à « qu'y a-t-il en [coordonnées] ? »)."""
        col, row = pos
        for quadrant in Quadrant:
            piece = self._occupancy.get((col, row, quadrant))
            if piece is not None:
                return piece
        return None

    def place_piece(self, piece: Piece) -> None:
        """Pose une pièce après validation complète des règles de placement."""
        quadrants = piece.quadrants()
        self._validate_placement(quadrants)
        self._pieces.append(piece)
        for quadrant_key in quadrants:
            self._occupancy[quadrant_key] = piece

    def remove_piece(self, piece: Piece) -> None:
        """Retire une pièce posée (ajustement pendant la phase de
        placement, avant validation — voir `rooms/`)."""
        if piece not in self._pieces:
            raise PlacementError("Cette pièce n'est pas posée sur ce plateau.")
        self._pieces.remove(piece)
        for quadrant_key in piece.quadrants():
            if self._occupancy.get(quadrant_key) is piece:
                del self._occupancy[quadrant_key]

    def _validate_placement(self, quadrants: set[tuple[int, int, Quadrant]]) -> None:
        if not quadrants:
            raise PlacementError("La pièce ne couvre aucune case : placement invalide.")

        for col, row, _ in quadrants:
            if not self.contains_cell((col, row)):
                raise PlacementError(f"La pièce déborde du plateau en ({col}, {row}).")

        for key in quadrants:
            if key in self._occupancy:
                raise PlacementError(f"{key} est déjà occupé par une autre pièce.")

        for col, row, quadrant in quadrants:
            for neighbor in edge_adjacent_neighbors(col, row, quadrant):
                if neighbor in quadrants:
                    continue  # appartient à la pièce qu'on est en train de poser
                other = self._occupancy.get(neighbor)
                if other is not None:
                    raise PlacementError(
                        f"La pièce toucherait une autre pièce par un bord entier en {neighbor} "
                        "— deux pièces ne peuvent se toucher que par un point (règle du livret)."
                    )
