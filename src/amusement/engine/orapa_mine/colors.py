"""Couleurs des gemmes et règles de mélange du rayon (Orapa Mine).

Le rayon est transparent au départ et se teinte en touchant des gemmes.
Le livret officiel confirme explicitement :
- une seule couleur touchée -> le rayon prend cette couleur ;
- une couleur + blanc -> version "claire" (rose, jaune clair, bleu clair) ;
- les 4 couleurs de base -> gris ;
- chaque couleur ne compte qu'une fois, même touchée plusieurs fois.

Le tableau de mélanges du livret (photographié, voir regles/orapamine.jpg
— confirmé par l'utilisateur) donne tous les cas à partir de 2 couleurs :
- une paire sans blanc suit un mélange classique type peinture
  (rouge+jaune=orange, jaune+bleu=vert, rouge+bleu=violet) ;
- une paire avec blanc donne une version "claire" (rose, jaune clair,
  bleu clair) ;
- un triplet de 2 couleurs + blanc donne la version claire du mélange
  correspondant (violet clair, vert clair, orange clair) ;
- rouge+jaune+bleu SANS blanc -> noir ;
- les 4 couleurs (rouge+jaune+bleu+blanc) -> gris.
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
_TRIPLE_NO_WHITE = frozenset({Color.RED, Color.YELLOW, Color.BLUE})


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
    if touched == _TRIPLE_NO_WHITE:
        return "noir"
    if len(touched) == 2 and touched in _PAIR_MIX:
        return _PAIR_MIX[touched]
    if len(touched) == 3 and touched in _TRIPLE_WITH_WHITE_MIX:
        return _TRIPLE_WITH_WHITE_MIX[touched]
    raise AssertionError(f"Combinaison de couleurs inattendue : {touched}")  # les 15 cas sont couverts ci-dessus
