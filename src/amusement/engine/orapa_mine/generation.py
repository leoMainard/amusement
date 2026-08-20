"""Génération aléatoire d'un plateau valide (mode Fouille)."""

from __future__ import annotations

import random
from dataclasses import dataclass

from .board import Board, BoardDimensions, GemKind, PlacementError, Piece
from .colors import Color
from .pieces import PieceShape


@dataclass(frozen=True)
class PieceSpec:
    """Une pièce à placer lors de la génération.

    `color` est requis pour `GemKind.NORMAL` et doit être `None` sinon ;
    `shape` doit être `TENT` pour DIAMOND/BLACK_BODY, et l'une des 4
    silhouettes réelles sinon.
    """

    shape: PieceShape
    kind: GemKind = GemKind.NORMAL
    color: Color | None = None


# Variante de base, confirmée avec l'utilisateur (voir docs/plan.md) :
# 1 parallélogramme rouge, 1 triangle moyen jaune, 1 grand triangle bleu,
# 1 losange blanc, 1 grand triangle blanc — soit exactement "1 rouge,
# 1 jaune, 1 bleue et 2 blanches" du livret officiel.
BASE_PIECE_SET: tuple[PieceSpec, ...] = (
    PieceSpec(PieceShape.PARALLELOGRAM, color=Color.RED),
    PieceSpec(PieceShape.MEDIUM_TRIANGLE, color=Color.YELLOW),
    PieceSpec(PieceShape.LARGE_TRIANGLE, color=Color.BLUE),
    PieceSpec(PieceShape.RHOMBUS, color=Color.WHITE),
    PieceSpec(PieceShape.LARGE_TRIANGLE, color=Color.WHITE),
)


def random_board(
    dimensions: BoardDimensions | None = None,
    pieces: tuple[PieceSpec, ...] = BASE_PIECE_SET,
    *,
    rng: random.Random | None = None,
    max_attempts: int = 5000,
) -> Board:
    """Place aléatoirement `pieces` sur un plateau neuf, en respectant
    toutes les règles de placement (voir `Board.place_piece`).

    Tirage-rejet simple : à chaque tentative, un placement complet
    (origine, rotation, miroir pour chaque pièce) est tiré au hasard ;
    s'il viole une règle, on repart de zéro.
    """
    rng = rng or random.Random()
    dims = dimensions or BoardDimensions()

    for _ in range(max_attempts):
        board = Board(dims)
        try:
            for spec in pieces:
                board.place_piece(_random_piece(spec, dims, rng))
        except PlacementError:
            continue
        return board

    raise RuntimeError(f"Impossible de générer un plateau valide après {max_attempts} tentatives.")


def _random_piece(spec: PieceSpec, dims: BoardDimensions, rng: random.Random) -> Piece:
    origin = (rng.randrange(dims.width), rng.randrange(dims.height))
    rotation_steps = rng.randrange(4)
    mirrored = rng.choice((False, True))

    if spec.kind == GemKind.BLACK_BODY:
        return Piece.black_body(origin)
    if spec.kind == GemKind.DIAMOND:
        return Piece.diamond(origin)
    assert spec.color is not None
    return Piece.normal(spec.shape, spec.color, origin, rotation_steps, mirrored)
