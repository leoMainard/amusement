from amusement.engine.orapa_mine.geometry import Quadrant, polygon_to_quadrants
from amusement.engine.orapa_mine.pieces import PieceShape, place_shape

# Nombre de quartiers (1 case pleine = 4 quartiers, 1 triangle = 2
# quartiers) attendu pour chaque forme, d'après sa composition confirmée
# dans docs/plan.md.
EXPECTED_QUADRANT_COUNT = {
    PieceShape.MEDIUM_TRIANGLE: 4 + 2 + 2,  # 1 carré + 2 triangles
    PieceShape.PARALLELOGRAM: 4 + 2 + 2,  # 1 carré + 2 triangles
    PieceShape.RHOMBUS: 2 + 2 + 2 + 2,  # 4 triangles
    PieceShape.LARGE_TRIANGLE: 4 + 4 + 2 + 2 + 2 + 2,  # 2 carrés + 4 triangles
    PieceShape.SQUARE: 4,  # 1 carré (Diamant / Corps noir)
}


def test_quadrant_count_matches_composition_for_every_shape() -> None:
    for shape, expected in EXPECTED_QUADRANT_COUNT.items():
        vertices = place_shape(shape, origin=(0, 0))
        quadrants = polygon_to_quadrants(vertices)
        assert len(quadrants) == expected, f"{shape}: {len(quadrants)} != {expected}"


def test_medium_triangle_quadrants_match_hand_derivation() -> None:
    # Dérivé à la main dans docs/plan.md : case (0,0) pleine, et les
    # cases (1,0) / (0,1) n'ont que leurs quartiers N et W occupés (le
    # reste de l'hypoténuse).
    vertices = place_shape(PieceShape.MEDIUM_TRIANGLE, origin=(0, 0))
    quadrants = polygon_to_quadrants(vertices)

    expected = {
        (0, 0, Quadrant.N), (0, 0, Quadrant.E), (0, 0, Quadrant.S), (0, 0, Quadrant.W),
        (1, 0, Quadrant.N), (1, 0, Quadrant.W),
        (0, 1, Quadrant.N), (0, 1, Quadrant.W),
    }
    assert quadrants == expected


def test_rotation_preserves_quadrant_count() -> None:
    for shape in PieceShape:
        base = len(polygon_to_quadrants(place_shape(shape, origin=(0, 0))))
        for steps in (1, 2, 3):
            rotated = len(polygon_to_quadrants(place_shape(shape, origin=(0, 0), rotation_steps=steps)))
            assert rotated == base, f"{shape} rotation={steps}: {rotated} != {base}"


def test_mirror_preserves_quadrant_count() -> None:
    for shape in PieceShape:
        base = len(polygon_to_quadrants(place_shape(shape, origin=(0, 0))))
        mirrored = len(polygon_to_quadrants(place_shape(shape, origin=(0, 0), mirrored=True)))
        assert mirrored == base


def test_parallelogram_mirror_differs_from_all_rotations() -> None:
    # Le parallélogramme n'a pas de symétrie miroir : son image miroir
    # ne doit être atteignable par aucune des 4 rotations (d'où le
    # besoin d'un bouton "retourner" distinct dans l'UI).
    base_variants = {
        frozenset(polygon_to_quadrants(place_shape(PieceShape.PARALLELOGRAM, origin=(0, 0), rotation_steps=steps)))
        for steps in range(4)
    }
    mirrored = frozenset(
        polygon_to_quadrants(place_shape(PieceShape.PARALLELOGRAM, origin=(0, 0), mirrored=True))
    )
    assert mirrored not in base_variants


def test_translation_shifts_quadrants_by_origin() -> None:
    at_origin = polygon_to_quadrants(place_shape(PieceShape.RHOMBUS, origin=(0, 0)))
    shifted = polygon_to_quadrants(place_shape(PieceShape.RHOMBUS, origin=(3, 5)))
    expected = {(col + 3, row + 5, quadrant) for col, row, quadrant in at_origin}
    assert shifted == expected
