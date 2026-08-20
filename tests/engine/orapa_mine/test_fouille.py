import pytest

from amusement.engine.orapa_mine.board import Board, BoardDimensions, Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.fouille import FouilleError, FouilleGame, FouilleMode
from amusement.engine.orapa_mine.pieces import PieceShape


def make_board() -> Board:
    board = Board(BoardDimensions(width=9, height=9))
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))
    return board


def wrong_guess() -> list[Piece]:
    return [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(3, 3))]


def correct_guess(board: Board) -> list[Piece]:
    return board.pieces()


def test_first_correct_guess_wins() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", correct_guess(board))
    assert game.finished
    assert game.winner == "a"


def test_single_wrong_guess_does_not_eliminate() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", wrong_guess())
    assert not game.finished
    assert "a" not in game.eliminated


def test_second_wrong_guess_eliminates() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", wrong_guess())
    game.submit_solution("a", wrong_guess())
    assert "a" in game.eliminated
    assert not game.finished  # "b" peut encore jouer


def test_all_players_eliminated_means_no_winner() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    for player in ("a", "b"):
        game.submit_solution(player, wrong_guess())
        game.submit_solution(player, wrong_guess())
    assert game.finished
    assert game.winner is None


def test_eliminated_player_cannot_act_again() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", wrong_guess())
    game.submit_solution("a", wrong_guess())
    with pytest.raises(FouilleError):
        game.ask_peek("a", (0, 0))


def test_parallel_private_has_no_turn_order() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"), mode=FouilleMode.PARALLEL_PRIVATE)
    assert game.current_turn_player() is None
    game.ask_peek("b", (0, 0))
    game.ask_peek("b", (0, 0))
    game.ask_peek("a", (0, 0))


def test_turn_based_enforces_order() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"), mode=FouilleMode.TURN_BASED)
    assert game.current_turn_player() == "a"
    with pytest.raises(FouilleError):
        game.ask_peek("b", (0, 0))
    game.ask_peek("a", (0, 0))
    assert game.current_turn_player() == "b"


def test_turn_based_rotation_skips_eliminated_players() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b", "c"), mode=FouilleMode.TURN_BASED)
    assert game.current_turn_player() == "a"
    game.submit_solution("a", wrong_guess())
    assert game.current_turn_player() == "b"
    game.submit_solution("b", wrong_guess())
    assert game.current_turn_player() == "c"
    game.submit_solution("c", wrong_guess())
    assert game.current_turn_player() == "a"
    game.submit_solution("a", wrong_guess())  # 2e erreur de "a" -> éliminé
    assert "a" in game.eliminated
    assert game.current_turn_player() == "b"  # "a" est sauté
