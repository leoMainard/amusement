import random

import pytest

from amusement.engine.orapa_mine.board import BoardDimensions, GemKind
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.generation import BASE_PIECE_SET, PieceSpec, random_board
from amusement.engine.orapa_mine.pieces import PieceShape


def test_random_board_places_every_requested_piece() -> None:
    board = random_board(BoardDimensions(width=9, height=9), rng=random.Random(42))
    pieces = board.pieces()
    assert len(pieces) == len(BASE_PIECE_SET)
    colors = sorted((p.color.name for p in pieces))
    expected = sorted((spec.color.name for spec in BASE_PIECE_SET))
    assert colors == expected


def test_random_board_is_deterministic_for_a_given_seed() -> None:
    dims = BoardDimensions(width=9, height=9)
    board_a = random_board(dims, rng=random.Random(7))
    board_b = random_board(dims, rng=random.Random(7))
    def signature(piece):
        return (piece.shape.name, piece.color.name, piece.origin, piece.rotation_steps, piece.mirrored)

    signatures_a = sorted(signature(p) for p in board_a.pieces())
    signatures_b = sorted(signature(p) for p in board_b.pieces())
    assert signatures_a == signatures_b


def test_random_board_can_include_extensions() -> None:
    specs = (
        PieceSpec(PieceShape.MEDIUM_TRIANGLE, color=Color.RED),
        PieceSpec(PieceShape.SQUARE, kind=GemKind.DIAMOND),
        PieceSpec(PieceShape.SQUARE, kind=GemKind.BLACK_BODY),
    )
    board = random_board(BoardDimensions(width=9, height=9), specs, rng=random.Random(1))
    kinds = sorted(p.kind.name for p in board.pieces())
    assert kinds == ["BLACK_BODY", "DIAMOND", "NORMAL"]


def test_random_board_gives_up_when_it_cannot_fit_everything() -> None:
    # 2x2 : bien trop petit pour caser 2 losanges (chacun 2x2 à lui seul).
    specs = (
        PieceSpec(PieceShape.RHOMBUS, color=Color.WHITE),
        PieceSpec(PieceShape.RHOMBUS, color=Color.RED),
    )
    with pytest.raises(RuntimeError):
        random_board(BoardDimensions(width=2, height=2), specs, rng=random.Random(0), max_attempts=20)
