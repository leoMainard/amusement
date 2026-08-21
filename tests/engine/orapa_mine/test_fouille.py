import pytest

from amusement.engine.orapa_mine.board import Board, BoardDimensions, Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.fouille import FouilleError, FouilleGame
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
    game.submit_solution("b", wrong_guess())  # tour par tour : b joue entre les deux essais de a
    game.submit_solution("a", wrong_guess())
    assert "a" in game.eliminated
    assert not game.finished  # "b" peut encore jouer


def test_all_players_eliminated_means_no_winner() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    for _ in range(2):
        game.submit_solution("a", wrong_guess())
        game.submit_solution("b", wrong_guess())
    assert game.finished
    assert game.winner is None


def test_eliminated_player_cannot_act_again() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", wrong_guess())
    game.submit_solution("b", wrong_guess())
    game.submit_solution("a", wrong_guess())  # 2e erreur de "a" -> éliminé
    assert "a" in game.eliminated
    with pytest.raises(FouilleError):
        game.ask_peek("a", (0, 0))


def test_turn_based_enforces_order() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    assert game.current_turn_player() == "a"
    with pytest.raises(FouilleError):
        game.ask_peek("b", (0, 0))
    # Poser une question ne fait pas avancer le tour (voir docstring du
    # module), mais une seule question par tour reste appliquée.
    game.ask_peek("a", (0, 0))
    assert game.current_turn_player() == "a"
    with pytest.raises(FouilleError):
        game.ask_ray("a", "1")
    game.pass_turn("a")
    assert game.current_turn_player() == "b"


def test_turn_based_rotation_skips_eliminated_players() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b", "c"))
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


def test_solo_player_always_has_the_turn() -> None:
    # Mode Fouille jouable seul : un seul joueur, donc toujours son tour
    # (voir docs/plan.md, retour utilisateur direct).
    board = make_board()
    game = FouilleGame(board=board, players=("solo",))
    assert game.current_turn_player() == "solo"
    game.ask_peek("solo", (0, 0))
    assert game.current_turn_player() == "solo"  # toujours son tour
    with pytest.raises(FouilleError):
        game.ask_ray("solo", "1")  # une seule question par tour
    game.pass_turn("solo")  # termine le tour : réarme le droit à une question
    assert game.current_turn_player() == "solo"
    game.ask_ray("solo", "1")  # ne lève plus


def test_at_least_one_player_required() -> None:
    board = make_board()
    with pytest.raises(ValueError):
        FouilleGame(board=board, players=())


def test_pass_turn_hands_off_without_a_question() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.pass_turn("a")
    assert game.current_turn_player() == "b"


def test_only_one_question_per_turn() -> None:
    # "C'est la même chose pour le mode fouille" (retour utilisateur
    # direct) : même limite qu'en Duel.
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.ask_ray("a", "1")
    with pytest.raises(FouilleError):
        game.ask_peek("a", (0, 0))
    game.pass_turn("a")
    game.pass_turn("b")
    game.ask_ray("a", "1")  # ne lève plus, nouveau tour


def test_pass_turn_out_of_turn_raises() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    with pytest.raises(FouilleError):
        game.pass_turn("b")


def test_pass_turn_eliminated_player_raises() -> None:
    board = make_board()
    game = FouilleGame(board=board, players=("a", "b"))
    game.submit_solution("a", wrong_guess())
    game.submit_solution("b", wrong_guess())
    game.submit_solution("a", wrong_guess())  # 2e erreur de "a" -> éliminé
    assert "a" in game.eliminated
    with pytest.raises(FouilleError):
        game.pass_turn("a")
