"""Lancer de rayon et réflexions sur les pièces (Orapa Mine).

Révision : les pièces occupent des silhouettes à plusieurs cases (voir
`pieces.py` / `board.py`), donc le rayon peut désormais heurter soit une
arête diagonale à 45° (dévie de 90°, comme avant), soit une arête droite
perpendiculaire à sa trajectoire (rebond à 180°, il ressort par son
point d'entrée — mécanisme du jeu classique Black Box dont s'inspire
Orapa Mine ; confirmé avec l'utilisateur avant cette révision).

Tout se calcule en arithmétique entière exacte, à l'échelle ×2 par
rapport à la grille (le centre de la case (c, r) est en (2c+1, 2r+1)) :
cette échelle suffit à représenter exactement à la fois les sommets des
pièces (coordonnées entières, donc paires à cette échelle) et la ligne
de tir du rayon (toujours sur une ligne/colonne « centrale », donc
impaire à cette échelle). Un rayon horizontal ne croise donc jamais une
arête horizontale (ni un rayon vertical une arête verticale) : la parité
l'exclut structurellement, pas besoin de cas particulier.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto

from .board import Board, GemKind, Piece
from .colors import Color, resolve_ray_color
from .geometry import polygon_edges
from .pieces import Position


class Direction(Enum):
    UP = auto()
    DOWN = auto()
    LEFT = auto()
    RIGHT = auto()


_AXIS: dict[Direction, str] = {
    Direction.UP: "y",
    Direction.DOWN: "y",
    Direction.LEFT: "x",
    Direction.RIGHT: "x",
}
_SIGN: dict[Direction, int] = {
    Direction.UP: -1,
    Direction.DOWN: 1,
    Direction.LEFT: -1,
    Direction.RIGHT: 1,
}
_REVERSE: dict[Direction, Direction] = {
    Direction.UP: Direction.DOWN,
    Direction.DOWN: Direction.UP,
    Direction.LEFT: Direction.RIGHT,
    Direction.RIGHT: Direction.LEFT,
}

# Réflexion sur une arête diagonale, selon son "signe" (+1 = ses deux
# coordonnées croissent ensemble ; -1 = en sens opposé) et la direction
# entrante. Vérifié indépendamment par la loi de réflexion (d' = d -
# 2(d·n̂)n̂) — voir docs/plan.md.
_DIAGONAL_REFLECTION: dict[int, dict[Direction, Direction]] = {
    -1: {
        Direction.RIGHT: Direction.UP,
        Direction.UP: Direction.RIGHT,
        Direction.LEFT: Direction.DOWN,
        Direction.DOWN: Direction.LEFT,
    },
    1: {
        Direction.RIGHT: Direction.DOWN,
        Direction.DOWN: Direction.RIGHT,
        Direction.LEFT: Direction.UP,
        Direction.UP: Direction.LEFT,
    },
}


def _to_scaled(pos: Position) -> tuple[int, int]:
    col, row = pos
    return (2 * col + 1, 2 * row + 1)


def _from_scaled_exit(point: tuple[int, int]) -> Position:
    """Convertit un point de sortie (sur le bord du plateau, donc pair
    sur l'axe de déplacement) en position de case affichable."""
    x, y = point
    return (x // 2, y // 2)


@dataclass(frozen=True)
class RayResult:
    entry: Position
    entry_direction: Direction
    exit: Position | None  # None si absorbé
    exit_direction: Direction | None
    color: str
    absorbed: bool = False


@dataclass(frozen=True)
class _Hit:
    distance: int
    point: tuple[int, int]
    piece: Piece | None  # None = sortie par le bord du plateau
    diagonal_sign: int | None  # None pour une arête droite (rebond 180°)


def fire_ray(board: Board, entry: Position, direction: Direction) -> RayResult:
    """Simule un rayon envoyé depuis `entry`, en dehors du plateau, en
    direction `direction` (voir `borders.py` pour la conversion depuis
    les libellés du livret)."""
    if board.contains_cell(entry):
        raise ValueError(f"{entry} est à l'intérieur du plateau : ce n'est pas un point d'entrée valide.")

    position = _to_scaled(entry)
    current_direction = direction
    touched: set[Color] = set()
    max_steps = (board.width + board.height) * 4 + 8  # marge de sécurité

    for _ in range(max_steps):
        hit = _next_event(board, position, current_direction)

        if hit.piece is None:
            exit_pos = _from_scaled_exit(hit.point)
            return RayResult(entry, direction, exit_pos, current_direction, resolve_ray_color(frozenset(touched)))

        if hit.piece.kind == GemKind.BLACK_BODY:
            return RayResult(entry, direction, None, None, "absorbé", absorbed=True)

        if hit.piece.kind == GemKind.NORMAL:
            assert hit.piece.color is not None
            touched.add(hit.piece.color)

        position = hit.point
        if hit.diagonal_sign is None:
            current_direction = _REVERSE[current_direction]
        else:
            current_direction = _DIAGONAL_REFLECTION[hit.diagonal_sign][current_direction]

    raise RuntimeError(f"Le rayon ne sort jamais du plateau après {max_steps} étapes : boucle de réflexions détectée.")


def peek(board: Board, pos: Position) -> str:
    """Réponse à « Qu'y a-t-il en [coordonnées] ? »."""
    piece = board.piece_at_cell(pos)
    if piece is None:
        return "Rien"
    if piece.kind == GemKind.DIAMOND:
        return "Un diamant"
    if piece.kind == GemKind.BLACK_BODY:
        return "Un corps noir"
    assert piece.color is not None
    label = {
        Color.RED: "rouge",
        Color.YELLOW: "jaune",
        Color.BLUE: "bleue",
        Color.WHITE: "blanche",
    }[piece.color]
    return f"Une gemme {label}"


def _next_event(board: Board, position: tuple[int, int], direction: Direction) -> _Hit:
    """Le prochain événement sur la trajectoire depuis `position` : soit
    l'arête de pièce la plus proche devant, soit la sortie du plateau si
    rien n'est touché avant."""
    axis = _AXIS[direction]
    sign = _SIGN[direction]
    board_edge = _board_edge_scaled(board, direction, position)

    best = _Hit(
        distance=_signed_distance(board_edge, position, axis, sign),
        point=board_edge,
        piece=None,
        diagonal_sign=None,
    )

    for piece in board.pieces():
        vertices = [(2 * x, 2 * y) for x, y in piece.vertices()]
        for edge_start, edge_end in polygon_edges(vertices):
            candidate = _edge_crossing(position, direction, edge_start, edge_end)
            if candidate is None:
                continue
            point, diagonal_sign = candidate
            distance = _signed_distance(point, position, axis, sign)
            if distance <= 0:
                continue
            if distance <= best.distance:
                best = _Hit(distance=distance, point=point, piece=piece, diagonal_sign=diagonal_sign)

    return best


def _signed_distance(point: tuple[int, int], position: tuple[int, int], axis: str, sign: int) -> int:
    moving = 0 if axis == "x" else 1
    return sign * (point[moving] - position[moving])


def _board_edge_scaled(board: Board, direction: Direction, position: tuple[int, int]) -> tuple[int, int]:
    """Le point où la trajectoire actuelle croise le bord du plateau,
    si rien ne l'arrête avant : l'axe de déplacement prend la valeur du
    bord concerné, l'axe fixe garde la coordonnée actuelle de `position`
    (c'est aussi un point de sortie potentiel, donc les deux coordonnées
    doivent être correctes, pas seulement celle utilisée pour comparer
    les distances)."""
    x, y = position
    if direction == Direction.RIGHT:
        x = 2 * board.width
    elif direction == Direction.LEFT:
        x = -1  # symétrique de l'entrée "col=-1" : une case avant le bord
    elif direction == Direction.DOWN:
        y = 2 * board.height
    elif direction == Direction.UP:
        y = -1  # symétrique de l'entrée "row=-1"
    return (x, y)


def _edge_crossing(
    position: tuple[int, int],
    direction: Direction,
    p1: tuple[int, int],
    p2: tuple[int, int],
) -> tuple[tuple[int, int], int | None] | None:
    """Si l'arête (p1, p2) croise la ligne de tir depuis `position` dans
    `direction`, renvoie (point_de_croisement, signe_diagonal) — signe
    `None` pour une arête droite perpendiculaire. Renvoie `None` si
    l'arête est parallèle au rayon ou ne le croise pas."""
    x1, y1 = p1
    x2, y2 = p2

    if _AXIS[direction] == "x":
        fixed = position[1]
        if y1 == y2:
            return None
        if not (min(y1, y2) < fixed < max(y1, y2)):
            return None
        if x1 == x2:
            return (x1, fixed), None
        diagonal_sign = 1 if (x2 - x1 > 0) == (y2 - y1 > 0) else -1
        x_hit = x1 + (fixed - y1) * diagonal_sign
        return (x_hit, fixed), diagonal_sign
    else:
        fixed = position[0]
        if x1 == x2:
            return None
        if not (min(x1, x2) < fixed < max(x1, x2)):
            return None
        if y1 == y2:
            return (fixed, y1), None
        diagonal_sign = 1 if (x2 - x1 > 0) == (y2 - y1 > 0) else -1
        y_hit = y1 + (fixed - x1) * diagonal_sign
        return (fixed, y_hit), diagonal_sign
