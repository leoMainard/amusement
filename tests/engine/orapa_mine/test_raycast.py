"""Tests du moteur de rayon (révision multi-cases).

Les scénarios sont construits à la main sur un plateau 9x9, avec les
vraies silhouettes de pièces, et vérifiés indépendamment par la loi de
réflexion d'un miroir (d' = d - 2(d·n̂)n̂) — voir docs/plan.md pour le
détail des calculs.
"""

import pytest

from amusement.engine.orapa_mine.board import Board, BoardDimensions, Piece
from amusement.engine.orapa_mine.colors import Color
from amusement.engine.orapa_mine.pieces import PieceShape
from amusement.engine.orapa_mine.raycast import Direction, fire_ray, peek


def make_board() -> Board:
    return Board(BoardDimensions(width=9, height=9))


def test_ray_with_no_piece_passes_straight_through() -> None:
    board = make_board()
    result = fire_ray(board, entry=(4, -1), direction=Direction.DOWN)
    assert result.exit == (4, 9)
    assert result.exit_direction == Direction.DOWN
    assert result.color == "transparent"
    assert not result.absorbed


def test_straight_edge_hit_bounces_back_out_the_entry() -> None:
    # Triangle moyen jaune, angle droit en (3,3), hypoténuse (5,3)-(3,5).
    # À la ligne 4 (sur la hauteur de son côté vertical gauche x=3), un
    # rayon entrant par la gauche heurte ce bord droit de face : il doit
    # rebondir à 180° et ressortir par son point d'entrée (mécanisme
    # « réflexion » du jeu Black Box, confirmé avec l'utilisateur).
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))

    result = fire_ray(board, entry=(-1, 4), direction=Direction.RIGHT)

    assert result.exit == (-1, 4)
    assert result.exit_direction == Direction.LEFT
    assert result.color == "jaune"
    assert not result.absorbed


def test_diagonal_hit_turns_the_ray_90_degrees() -> None:
    # Même triangle. Un rayon entrant par le bas (colonne 4, vers le
    # haut) heurte l'hypoténuse en biais : il tourne de 90° (ici vers la
    # droite) au lieu de rebondir, puisque l'arête touchée est à 45°.
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))

    result = fire_ray(board, entry=(4, 9), direction=Direction.UP)

    assert result.exit == (9, 3)
    assert result.exit_direction == Direction.RIGHT
    assert result.color == "jaune"


def test_two_pieces_reflect_and_mix_colors() -> None:
    # Prolonge le scénario précédent : après avoir tourné vers la
    # droite sur le triangle jaune, le rayon heurte un losange blanc
    # plus loin sur sa ligne, tourne à nouveau, et ressort par le bas —
    # le mélange jaune+blanc doit donner "jaune clair".
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))
    board.place_piece(Piece.normal(PieceShape.RHOMBUS, Color.WHITE, origin=(6, 2)))

    result = fire_ray(board, entry=(4, 9), direction=Direction.UP)

    assert result.exit == (6, 9)
    assert result.exit_direction == Direction.DOWN
    assert result.color == "jaune clair"


def test_black_body_absorbs_regardless_of_edge_type() -> None:
    board = make_board()
    board.place_piece(Piece.black_body(origin=(4, 4)))

    result = fire_ray(board, entry=(-1, 4), direction=Direction.RIGHT)

    assert result.absorbed
    assert result.exit is None
    assert result.color == "absorbé"


def test_diamond_deflects_without_tinting() -> None:
    # Le Diamant a la silhouette TENT (deux demi-cases pointe en haut) :
    # un rayon entrant à mi-hauteur de la ligne 4 heurte son arête
    # diagonale gauche, donc tourne de 90° (ici vers le haut) au lieu de
    # rebondir — comme n'importe quelle pièce touchée sur une arête à
    # 45°, mais sans teinter le rayon.
    board = make_board()
    board.place_piece(Piece.diamond(origin=(4, 4)))

    result = fire_ray(board, entry=(-1, 4), direction=Direction.RIGHT)

    assert result.exit == (4, -1)
    assert result.exit_direction == Direction.UP
    assert result.color == "transparent"
    assert not result.absorbed


def test_entry_must_be_outside_the_board() -> None:
    board = make_board()
    with pytest.raises(ValueError):
        fire_ray(board, entry=(4, 4), direction=Direction.RIGHT)


def test_peek_reports_cell_contents() -> None:
    board = make_board()
    board.place_piece(Piece.normal(PieceShape.MEDIUM_TRIANGLE, Color.YELLOW, origin=(3, 3)))
    board.place_piece(Piece.black_body(origin=(0, 0)))

    assert peek(board, (3, 3)) == "Une gemme jaune"
    assert peek(board, (4, 3)) == "Une gemme jaune"  # moitié de case du même triangle
    assert peek(board, (0, 0)) == "Un corps noir"
    assert peek(board, (8, 8)) == "Rien"
