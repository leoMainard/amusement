import pytest

from amusement.engine.orapa_mine.board import (
    Board,
    BoardDimensions,
    GemKind,
    PlacementError,
    Piece,
)
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.pieces import PieceShape


def make_board(width: int = 9, height: int = 9) -> Board:
    return Board(BoardDimensions(width=width, height=height))


def test_place_piece_out_of_bounds_rejected() -> None:
    board = make_board()
    # Le triangle moyen (2x2) déborderait du plateau depuis (8, 8).
    with pytest.raises(PlacementError):
        board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(8, 8)))


def test_place_piece_overlapping_another_rejected() -> None:
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))
    with pytest.raises(PlacementError):
        board.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(0, 0)))


def test_pieces_sharing_a_full_edge_rejected() -> None:
    board = make_board()
    # Deux triangles moyens accolés par leur côté vertical (0,0)-(0,2) :
    # un partagerait un bord entier avec l'autre.
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(2, 0)))
    with pytest.raises(PlacementError):
        board.place_piece(
            Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(0, 0), rotation_steps=1)
        )


def test_pieces_touching_only_by_a_corner_allowed() -> None:
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))
    # Un second triangle moyen, positionné en diagonale, ne touche le
    # premier qu'au point (2, 2) : autorisé.
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(2, 2)))
    assert len(board.pieces()) == 2


def test_diamond_and_black_body_use_square_footprint() -> None:
    board = make_board()
    board.place_piece(Piece.diamond(origin=(3, 3)))
    board.place_piece(Piece.black_body(origin=(5, 5)))
    diamond, black_body = board.pieces()
    assert diamond.kind == GemKind.DIAMOND
    assert diamond.color is None
    assert black_body.kind == GemKind.BLACK_BODY
    assert black_body.color is None


def test_normal_piece_requires_a_color() -> None:
    with pytest.raises(ValueError):
        Piece(shape=PieceShape.RHOMBUS, kind=GemKind.NORMAL, color=None, origin=(0, 0))


def test_normal_piece_cannot_use_square_shape() -> None:
    with pytest.raises(ValueError):
        Piece(shape=PieceShape.SQUARE, kind=GemKind.NORMAL, color=Color.RED, origin=(0, 0))


def test_diamond_cannot_use_a_colored_shape() -> None:
    with pytest.raises(ValueError):
        Piece(shape=PieceShape.RHOMBUS, kind=GemKind.DIAMOND, origin=(0, 0))


def test_remove_piece_frees_its_cells() -> None:
    board = make_board()
    piece = Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))
    board.place_piece(piece)
    board.remove_piece(piece)
    assert board.pieces() == []
    assert board.piece_at_cell((0, 0)) is None
    # La case est bien libre : une autre pièce peut désormais s'y poser.
    board.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(0, 0)))


def test_remove_piece_not_on_board_raises() -> None:
    board = make_board()
    piece = Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))
    with pytest.raises(PlacementError):
        board.remove_piece(piece)


def test_piece_at_cell_reports_the_covering_piece() -> None:
    board = make_board()
    piece = Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))
    board.place_piece(piece)
    assert board.piece_at_cell((0, 0)) is piece
    assert board.piece_at_cell((1, 0)) is piece  # moitié de case, mais bien occupée
    assert board.piece_at_cell((8, 8)) is None
