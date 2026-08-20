"""Géométrie exacte pour les pièces d'Orapa Mine.

Les pièces sont des polygones convexes à coins entiers (coordonnées de
grille), dont tous les côtés sont horizontaux, verticaux, ou à 45°. Pour
représenter précisément leur emprise — y compris les moitiés de case —
chaque case est divisée en 4 « quartiers » triangulaires (Nord, Est, Sud,
Ouest) qui se rejoignent au centre. N'importe quelle pièce valide occupe
exactement un sous-ensemble de ces quartiers : une case pleine = les 4
quartiers ; une moitié de case (coupée par une diagonale) = 2 quartiers
adjacents parmi N/E/S/W.

Tout est calculé en arithmétique entière exacte (aucun flottant) : la
règle de contact du livret (« les pièces ne se touchent que par un
point ») est un cas limite numériquement délicat, et les flottants s'y
prêtent mal.
"""

from __future__ import annotations

from enum import Enum, auto

Point = tuple[int, int]  # coordonnées de grille (non mises à l'échelle)


class Quadrant(Enum):
    N = auto()
    E = auto()
    S = auto()
    W = auto()


# Point-sonde interne de chaque quartier, en coordonnées mises à
# l'échelle ×4 par rapport à la grille (le centre de la case (c, r) est
# alors en (4c+2, 4r+2)).
_QUADRANT_PROBE: dict[Quadrant, tuple[int, int]] = {
    Quadrant.N: (2, 1),
    Quadrant.E: (3, 2),
    Quadrant.S: (2, 3),
    Quadrant.W: (1, 2),
}

# Paires de quartiers adjacents (partageant une arête de longueur non
# nulle) à l'intérieur d'une même case.
SAME_CELL_ADJACENT_PAIRS: tuple[tuple[Quadrant, Quadrant], ...] = (
    (Quadrant.N, Quadrant.E),
    (Quadrant.E, Quadrant.S),
    (Quadrant.S, Quadrant.W),
    (Quadrant.W, Quadrant.N),
)


def point_in_convex_polygon(point: tuple[int, int], vertices: list[tuple[int, int]]) -> bool:
    """True si `point` est strictement à l'intérieur du polygone convexe
    `vertices` (peu importe le sens de parcours). Arithmétique entière
    exacte : aucune division, uniquement des produits en croix.
    """
    sign = 0
    n = len(vertices)
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        cross = (x2 - x1) * (point[1] - y1) - (y2 - y1) * (point[0] - x1)
        if cross == 0:
            continue
        current_sign = 1 if cross > 0 else -1
        if sign == 0:
            sign = current_sign
        elif current_sign != sign:
            return False
    return True


def polygon_to_quadrants(vertices: list[Point]) -> set[tuple[int, int, Quadrant]]:
    """Convertit un polygone convexe (coordonnées de grille) en
    l'ensemble des quartiers (case, quartier) qu'il recouvre."""
    scaled = [(4 * x, 4 * y) for x, y in vertices]
    xs = [x for x, _ in vertices]
    ys = [y for _, y in vertices]
    result: set[tuple[int, int, Quadrant]] = set()
    for col in range(min(xs), max(xs)):
        for row in range(min(ys), max(ys)):
            for quadrant, (dx, dy) in _QUADRANT_PROBE.items():
                probe = (4 * col + dx, 4 * row + dy)
                if point_in_convex_polygon(probe, scaled):
                    result.add((col, row, quadrant))
    return result


def polygon_edges(vertices: list[Point]) -> list[tuple[Point, Point]]:
    """Les arêtes du polygone, dans l'ordre, chacune (point_départ, point_arrivée)."""
    n = len(vertices)
    return [(vertices[i], vertices[(i + 1) % n]) for i in range(n)]


# Cycle des quartiers adjacents à l'intérieur d'une même case (partage
# une arête allant du centre à un coin) : N-E, E-S, S-W, W-N.
_SAME_CELL_NEIGHBORS: dict[Quadrant, tuple[Quadrant, Quadrant]] = {
    Quadrant.N: (Quadrant.E, Quadrant.W),
    Quadrant.E: (Quadrant.N, Quadrant.S),
    Quadrant.S: (Quadrant.E, Quadrant.W),
    Quadrant.W: (Quadrant.N, Quadrant.S),
}

# Quartier du voisin de case directement en face (partage l'arête pleine
# du bord de case), et le décalage (colonne, ligne) de cette case voisine.
_CROSS_CELL_NEIGHBOR: dict[Quadrant, tuple[Quadrant, tuple[int, int]]] = {
    Quadrant.N: (Quadrant.S, (0, -1)),
    Quadrant.S: (Quadrant.N, (0, 1)),
    Quadrant.E: (Quadrant.W, (1, 0)),
    Quadrant.W: (Quadrant.E, (-1, 0)),
}


def edge_adjacent_neighbors(col: int, row: int, quadrant: Quadrant) -> list[tuple[int, int, Quadrant]]:
    """Les quartiers qui partagent une arête de longueur non nulle avec
    (col, row, quadrant) — 2 dans la même case, 1 dans la case voisine
    en face. Ne renvoie pas les quartiers qui ne partagent qu'un point
    (diagonale opposée dans la même case, ou case en diagonale)."""
    neighbors = [(col, row, q) for q in _SAME_CELL_NEIGHBORS[quadrant]]
    other_quadrant, (dcol, drow) = _CROSS_CELL_NEIGHBOR[quadrant]
    neighbors.append((col + dcol, row + drow, other_quadrant))
    return neighbors
