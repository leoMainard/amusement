from amusement.engine.orapa_mine.board import Board, BoardDimensions, Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.pieces import PieceShape
from amusement.engine.orapa_mine.solution import check_solution


def make_board() -> Board:
    board = Board(BoardDimensions(width=9, height=9))
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0)))
    board.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4)))
    return board


def test_exact_guess_is_correct() -> None:
    board = make_board()
    assert check_solution(board, board.pieces()) is True


def test_guess_with_wrong_color_is_incorrect() -> None:
    board = make_board()
    guess = [
        Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(0, 0)),
        Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4)),
    ]
    assert check_solution(board, guess) is False


def test_guess_with_wrong_position_is_incorrect() -> None:
    board = make_board()
    guess = [
        Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(1, 1)),
        Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4)),
    ]
    assert check_solution(board, guess) is False


def test_missing_piece_is_incorrect() -> None:
    board = make_board()
    guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(0, 0))]
    assert check_solution(board, guess) is False


def test_extra_piece_is_incorrect() -> None:
    board = make_board()
    guess = [
        *board.pieces(),
        Piece.black_body(origin=(8, 8)),
    ]
    assert check_solution(board, guess) is False


def test_guess_is_correct_regardless_of_how_the_same_footprint_was_parametrized() -> None:
    # Le losange a une symétrie de rotation : une rotation de 90° donne
    # exactement la même emprise au sol. La comparaison doit se faire
    # sur l'empreinte géométrique, pas sur les paramètres bruts de
    # placement (voir docstring de `solution.py`).
    board = Board(BoardDimensions(width=9, height=9))
    board.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4), rotation_steps=0))
    guess = [Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4), rotation_steps=1)]
    assert check_solution(board, guess) is True
