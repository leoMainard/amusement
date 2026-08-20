from amusement.engine.orapa_mine.colors import Color, resolve_ray_color


def test_no_color_touched_is_transparent() -> None:
    assert resolve_ray_color(frozenset()) == "transparent"


def test_single_color_passthrough() -> None:
    assert resolve_ray_color(frozenset({Color.RED})) == "rouge"
    assert resolve_ray_color(frozenset({Color.WHITE})) == "blanc"


def test_color_plus_white_gives_light_version() -> None:
    assert resolve_ray_color(frozenset({Color.RED, Color.WHITE})) == "rose"
    assert resolve_ray_color(frozenset({Color.YELLOW, Color.WHITE})) == "jaune clair"
    assert resolve_ray_color(frozenset({Color.BLUE, Color.WHITE})) == "bleu clair"


def test_all_four_colors_give_gray() -> None:
    assert resolve_ray_color(frozenset({Color.RED, Color.YELLOW, Color.BLUE, Color.WHITE})) == "gris"


def test_two_colors_without_white_mix_like_paint() -> None:
    assert resolve_ray_color(frozenset({Color.RED, Color.YELLOW})) == "orange"
    assert resolve_ray_color(frozenset({Color.YELLOW, Color.BLUE})) == "vert"
    assert resolve_ray_color(frozenset({Color.RED, Color.BLUE})) == "violet"


def test_two_colors_plus_white_gives_light_mix() -> None:
    assert resolve_ray_color(frozenset({Color.RED, Color.BLUE, Color.WHITE})) == "violet clair"
    assert resolve_ray_color(frozenset({Color.YELLOW, Color.BLUE, Color.WHITE})) == "vert clair"
    assert resolve_ray_color(frozenset({Color.RED, Color.YELLOW, Color.WHITE})) == "orange clair"


def test_three_primary_colors_without_white_gives_black() -> None:
    # Confirmé par le tableau de mélanges du livret (regles/orapamine.jpg).
    assert resolve_ray_color(frozenset({Color.RED, Color.YELLOW, Color.BLUE})) == "noir"


def test_repeated_color_counts_once() -> None:
    # Simule un rayon ayant touché deux gemmes rouges puis une blanche :
    # seul l'ensemble des couleurs distinctes touchées compte.
    touched = frozenset({Color.RED, Color.WHITE})
    assert resolve_ray_color(touched) == "rose"
