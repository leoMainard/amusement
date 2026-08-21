import pytest

from amusement.engine.orapa_mine.board import Board, BoardDimensions, Piece
from amusement.engine.orapa_mine.borders import LabelScheme
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.duel import DuelError, DuelGame
from amusement.engine.orapa_mine.pieces import PieceShape


def make_game(starting_player: str = "alice") -> DuelGame:
    dims = BoardDimensions(width=9, height=9)
    board_alice = Board(dims)
    board_alice.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))
    board_bob = Board(dims)
    board_bob.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(4, 4)))
    return DuelGame(
        players=("alice", "bob"),
        boards={"alice": board_alice, "bob": board_bob},
        starting_player=starting_player,
        label_scheme=LabelScheme(dims),
    )


def test_turns_alternate_after_a_question() -> None:
    game = make_game()
    assert game.current_prospector == "alice"
    game.ask_peek("alice", (0, 0))
    assert game.current_prospector == "bob"


def test_cannot_act_out_of_turn() -> None:
    game = make_game()
    with pytest.raises(DuelError):
        game.ask_peek("bob", (0, 0))


def test_wrong_guess_loses_immediately() -> None:
    game = make_game()
    wrong_guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    game.submit_solution("alice", wrong_guess)
    assert game.finished
    assert game.winner == "bob"
    assert not game.draw


def test_non_starting_player_correct_guess_wins_immediately() -> None:
    game = make_game(starting_player="alice")
    game.ask_peek("alice", (0, 0))  # passe la main à bob
    correct_guess = game.boards["alice"].pieces()
    game.submit_solution("bob", correct_guess)
    assert game.finished
    assert game.winner == "bob"


def test_starting_player_correct_guess_gives_opponent_a_final_turn() -> None:
    game = make_game(starting_player="alice")
    correct_guess = game.boards["bob"].pieces()
    game.submit_solution("alice", correct_guess)
    assert not game.finished
    assert game.current_prospector == "bob"


def test_opponent_wrong_on_final_turn_confirms_starting_player_win() -> None:
    game = make_game(starting_player="alice")
    game.submit_solution("alice", game.boards["bob"].pieces())
    wrong_guess = [Piece.normal(PieceShape.RHOMBUS, Color.RED, origin=(0, 0))]
    game.submit_solution("bob", wrong_guess)
    assert game.finished
    assert game.winner == "alice"
    assert not game.draw


def test_opponent_correct_on_final_turn_is_a_draw() -> None:
    game = make_game(starting_player="alice")
    game.submit_solution("alice", game.boards["bob"].pieces())
    game.submit_solution("bob", game.boards["alice"].pieces())
    assert game.finished
    assert game.draw
    assert game.winner is None


def test_opponent_skipping_final_turn_confirms_starting_player_win() -> None:
    game = make_game(starting_player="alice")
    game.submit_solution("alice", game.boards["bob"].pieces())
    game.ask_peek("bob", (0, 0))  # bob n'utilise pas son tour pour proposer
    assert game.finished
    assert game.winner == "alice"


def test_replay_does_not_consume_a_turn() -> None:
    game = make_game()
    game.ask_peek("alice", (0, 0))
    assert game.current_prospector == "bob"
    result = game.replay(0)
    assert result == "Rien"
    assert game.current_prospector == "bob"  # inchangé


def test_pass_turn_hands_off_without_a_question() -> None:
    game = make_game()
    game.pass_turn("alice")
    assert game.current_prospector == "bob"
    assert game.log == []  # aucune question posée, contrairement à ask_ray/ask_peek


def test_pass_turn_out_of_turn_raises() -> None:
    game = make_game()
    with pytest.raises(DuelError):
        game.pass_turn("bob")


def test_pass_turn_on_final_turn_confirms_starting_player_win() -> None:
    # Même cas particulier que "l'adversaire n'utilise pas son dernier
    # tour pour proposer" (voir test_opponent_skipping_final_turn_...),
    # mais via "Terminer mon tour"/expiration du chrono plutôt qu'une
    # vraie question.
    game = make_game(starting_player="alice")
    game.submit_solution("alice", game.boards["bob"].pieces())
    game.pass_turn("bob")
    assert game.finished
    assert game.winner == "alice"
