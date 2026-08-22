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


def test_asking_a_question_does_not_pass_the_turn() -> None:
    # Un tour est une fenêtre de temps, pas une action : poser une
    # question ne le consomme plus (retour utilisateur direct — "je
    # peux avoir besoin de temps pour réfléchir, positionner mes
    # pièces"). Seul `pass_turn` (bouton/expiration du chrono) le fait.
    game = make_game()
    assert game.current_prospector == "alice"
    game.ask_peek("alice", (0, 0))
    assert game.current_prospector == "alice"


def test_only_one_question_per_turn() -> None:
    # "sur un tour, il est possible de tirer un seul rayon OU
    # d'interroger une seule case" (retour utilisateur direct) : une
    # deuxième question pendant le même tour est refusée, qu'elle soit
    # du même type ou de l'autre.
    game = make_game()
    game.ask_peek("alice", (0, 0))
    with pytest.raises(DuelError):
        game.ask_ray("alice", "1")
    with pytest.raises(DuelError):
        game.ask_peek("alice", (1, 1))
    # Terminer le tour réarme le droit à une question pour le suivant.
    game.pass_turn("alice")
    game.pass_turn("bob")
    game.ask_peek("alice", (0, 0))  # ne lève plus


def test_pass_turn_alternates_turns() -> None:
    game = make_game()
    assert game.current_prospector == "alice"
    game.pass_turn("alice")
    assert game.current_prospector == "bob"


def test_cannot_act_out_of_turn() -> None:
    game = make_game()
    with pytest.raises(DuelError):
        game.ask_peek("bob", (0, 0))


def test_correct_guess_wins_immediately() -> None:
    game = make_game(starting_player="alice")
    correct_guess = game.boards["bob"].pieces()
    game.submit_solution("alice", correct_guess)
    assert game.finished
    assert game.winner == "alice"
    assert not game.draw


def test_wrong_guess_does_not_end_the_game() -> None:
    # "Peu importe le mode de jeu, je peux faire deux propositions. Si la
    # première proposition n'est pas bonne, un message me l'indique, mais
    # ne met pas fin à la partie" (retour utilisateur direct) — même
    # règle qu'en Fouille désormais (voir duel.py).
    game = make_game()
    wrong_guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    game.submit_solution("alice", wrong_guess)
    assert not game.finished
    assert "alice" not in game.eliminated
    # Une proposition (juste ou fausse) termine le tour de son auteur,
    # comme `pass_turn`.
    assert game.current_prospector == "bob"


def test_second_wrong_guess_eliminates_but_opponent_keeps_playing() -> None:
    game = make_game()
    wrong_guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    game.submit_solution("alice", wrong_guess)
    game.pass_turn("bob")  # bob joue entre les deux essais d'alice
    game.submit_solution("alice", wrong_guess)  # 2e erreur -> éliminée
    assert "alice" in game.eliminated
    assert not game.finished  # bob peut encore trouver/se tromper
    # Il n'y a que 2 joueurs : une fois alice éliminée, bob garde la main
    # en continu (personne d'autre à qui la passer) — retour utilisateur
    # direct, sans quoi la partie resterait bloquée sur le tour d'alice.
    assert game.current_prospector == "bob"
    game.pass_turn("bob")
    assert game.current_prospector == "bob"


def test_both_players_eliminated_is_a_draw() -> None:
    game = make_game()
    wrong_alice = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    wrong_bob = [Piece.normal(PieceShape.RHOMBUS, Color.RED, origin=(0, 0))]
    game.submit_solution("alice", wrong_alice)
    game.submit_solution("bob", wrong_bob)
    game.submit_solution("alice", wrong_alice)  # alice éliminée
    assert not game.finished
    game.submit_solution("bob", wrong_bob)  # bob éliminé aussi
    assert game.finished
    assert game.draw
    assert game.winner is None


def test_eliminated_player_cannot_act_again() -> None:
    game = make_game()
    wrong_guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    game.submit_solution("alice", wrong_guess)
    game.pass_turn("bob")
    game.submit_solution("alice", wrong_guess)  # 2e erreur -> éliminée
    assert "alice" in game.eliminated
    with pytest.raises(DuelError):
        game.ask_peek("alice", (0, 0))
    with pytest.raises(DuelError):
        game.pass_turn("alice")


def test_last_guess_is_recorded_for_the_results_screen() -> None:
    game = make_game()
    wrong_guess = [Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.BLUE, origin=(4, 4))]
    game.submit_solution("alice", wrong_guess)
    assert game.last_guess["alice"] == wrong_guess


def test_replay_does_not_consume_a_turn() -> None:
    game = make_game()
    game.ask_peek("alice", (0, 0))
    game.pass_turn("alice")
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
