"""Couleurs des gemmes et règles de mélange du rayon (Orapa Mine).

Le rayon est transparent au départ et se teinte en touchant des gemmes.
Le livret officiel confirme explicitement :
- une seule couleur touchée -> le rayon prend cette couleur ;
- une couleur + blanc -> version "claire" (rose, jaune clair, bleu clair) ;
- les 4 couleurs de base -> gris ;
- chaque couleur ne compte qu'une fois, même touchée plusieurs fois.

Les schémas du livret (résultats "orange", "vert", "violet" sur les
exemples d'extension Corps noir) indiquent en plus un mélange classique
type peinture pour les paires sans blanc (rouge+jaune=orange,
jaune+bleu=vert, rouge+bleu=violet), et un exemple de dialogue confirme
qu'ajouter du blanc à un mélange de deux couleurs donne sa version
"claire" (rouge+bleu+blanc -> violet clair ; jaune+bleu+blanc -> vert
clair, vu dans deux schémas). Par cohérence, rouge+jaune+blanc est donc
supposé donner "orange clair" (non confirmé littéralement dans le texte
disponible, mais suit le même motif).

Le mélange des 3 couleurs de base sans blanc (rouge+jaune+bleu) n'est
mentionné nulle part dans le livret : plutôt que d'inventer un nom, on
retombe sur une description explicite. À corriger si le nom officiel est
retrouvé (voir docs/plan.md).
"""

from __future__ import annotations

from enum import Enum, auto


class Color(Enum):
    """Les quatre couleurs de gemme de la version de base."""

    RED = auto()
    YELLOW = auto()
    BLUE = auto()
    WHITE = auto()


_PAIR_MIX: dict[frozenset[Color], str] = {
    # Une couleur + blanc -> version claire (confirmé par le livret).
    frozenset({Color.RED, Color.WHITE}): "rose",
    frozenset({Color.YELLOW, Color.WHITE}): "jaune clair",
    frozenset({Color.BLUE, Color.WHITE}): "bleu clair",
    # Deux couleurs primaires sans blanc -> mélange type peinture (déduit
    # des schémas de l'extension Corps noir).
    frozenset({Color.RED, Color.YELLOW}): "orange",
    frozenset({Color.YELLOW, Color.BLUE}): "vert",
    frozenset({Color.RED, Color.BLUE}): "violet",
}

_TRIPLE_WITH_WHITE_MIX: dict[frozenset[Color], str] = {
    # Mélange de 2 couleurs + blanc -> version claire du mélange (confirmé
    # pour violet clair et vert clair par les schémas et le dialogue
    # d'exemple ; orange clair déduit par le même motif).
    frozenset({Color.RED, Color.BLUE, Color.WHITE}): "violet clair",
    frozenset({Color.YELLOW, Color.BLUE, Color.WHITE}): "vert clair",
    frozenset({Color.RED, Color.YELLOW, Color.WHITE}): "orange clair",
}

_ALL_FOUR = frozenset({Color.RED, Color.YELLOW, Color.BLUE, Color.WHITE})


def resolve_ray_color(touched: frozenset[Color]) -> str:
    """Nom de la couleur de sortie du rayon selon les couleurs traversées.

    `touched` est l'ensemble des couleurs de gemme touchées par le rayon
    (chaque couleur ne compte qu'une fois — règle c. du livret). Un rayon
    qui n'a touché aucune gemme colorée (rien, ou seulement des diamants)
    ressort "transparent".
    """
    if not touched:
        return "transparent"
    if len(touched) == 1:
        (only,) = touched
        return {
            Color.RED: "rouge",
            Color.YELLOW: "jaune",
            Color.BLUE: "bleu",
            Color.WHITE: "blanc",
        }[only]
    if touched == _ALL_FOUR:
        return "gris"
    if len(touched) == 2 and touched in _PAIR_MIX:
        return _PAIR_MIX[touched]
    if len(touched) == 3 and touched in _TRIPLE_WITH_WHITE_MIX:
        return _TRIPLE_WITH_WHITE_MIX[touched]
    # Rouge+jaune+bleu sans blanc : non défini par le livret disponible.
    names = ", ".join(
        {Color.RED: "rouge", Color.YELLOW: "jaune", Color.BLUE: "bleu", Color.WHITE: "blanc"}[c]
        for c in sorted(touched, key=lambda c: c.name)
    )
    return f"mélange non documenté ({names})"
