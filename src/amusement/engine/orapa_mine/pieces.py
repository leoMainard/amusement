"""Formes des pièces d'Orapa Mine et leur placement sur le plateau.

Cinq silhouettes réelles, confirmées manuellement (voir docs/plan.md) :
- `MEDIUM_TRIANGLE` (jaune) : 1 carré + 2 triangles, triangle rectangle.
- `PARALLELOGRAM` (rouge) : 1 carré + 2 triangles.
- `RHOMBUS` (blanc) : 4 triangles.
- `LARGE_TRIANGLE` (blanc ou bleu — même silhouette, deux couleurs
  possibles) : 2 carrés + 4 triangles, triangle rectangle deux fois plus
  grand que le triangle moyen.
- `TENT` : emprise du Diamant et du Corps noir (extensions). Deux
  triangles accolés par leur hypoténuse, formant un triangle isocèle de
  2 cases de large sur 1 de haut, pointe vers le haut — au sol, la
  silhouette d'une tente à deux pans vue de dessus.

Chaque forme est définie une fois, dans une orientation locale
canonique, à coins entiers. Le placement applique une rotation par pas
de 90°, une éventuelle réflexion miroir (nécessaire pour le
parallélogramme, qui n'a pas de symétrie miroir), puis une translation.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto

from .geometry import Point

Position = tuple[int, int]


class PieceShape(Enum):
    MEDIUM_TRIANGLE = auto()
    PARALLELOGRAM = auto()
    RHOMBUS = auto()
    LARGE_TRIANGLE = auto()
    TENT = auto()


# Vertices en orientation locale canonique (sens de parcours peu
# importe pour un polygone convexe).
_CANONICAL_VERTICES: dict[PieceShape, tuple[Point, ...]] = {
    PieceShape.MEDIUM_TRIANGLE: ((0, 0), (2, 0), (0, 2)),
    PieceShape.PARALLELOGRAM: ((0, 0), (2, 0), (3, 1), (1, 1)),
    PieceShape.RHOMBUS: ((1, 0), (2, 1), (1, 2), (0, 1)),
    PieceShape.LARGE_TRIANGLE: ((0, 0), (2, 2), (0, 4)),
    PieceShape.TENT: ((0, 1), (2, 1), (1, 0)),
}


def _rotate90(point: Point) -> Point:
    x, y = point
    return (-y, x)


def _mirror_x(point: Point) -> Point:
    x, y = point
    return (-x, y)


def place_shape(shape: PieceShape, origin: Position, rotation_steps: int = 0, mirrored: bool = False) -> list[Point]:
    """Renvoie les coins de `shape` en coordonnées du plateau, après
    une éventuelle réflexion miroir, une rotation de `rotation_steps` ×
    90°, puis une translation pour que le coin minimal de la boîte
    englobante tombe sur `origin`.
    """
    vertices = list(_CANONICAL_VERTICES[shape])

    if mirrored:
        vertices = [_mirror_x(v) for v in vertices]

    for _ in range(rotation_steps % 4):
        vertices = [_rotate90(v) for v in vertices]

    min_x = min(x for x, _ in vertices)
    min_y = min(y for _, y in vertices)
    origin_col, origin_row = origin
    return [(x - min_x + origin_col, y - min_y + origin_row) for x, y in vertices]
