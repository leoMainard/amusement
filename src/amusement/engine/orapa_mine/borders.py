"""Correspondance entre les libellés du livret (nombres 1-18, lettres
A-R) et les points d'entrée du plateau.

⚠️ Répartition provisoire, non confirmée visuellement avec certitude
(voir docs/plan.md). 18+18 = 36 correspond exactement au pourtour d'une
grille 9x9 (9+9 cases en haut/bas, 9+9 en gauche/droite), ce qui est
l'hypothèse retenue par défaut dans `board.BoardDimensions`.

Cette classe est volontairement isolée du moteur de rayon
(`raycast.fire_ray`), qui ne travaille que sur des positions/directions
brutes : si la vraie répartition des libellés s'avère différente, seule
cette classe a besoin d'être corrigée.
"""

from __future__ import annotations

from dataclasses import dataclass

from .board import BoardDimensions, Position
from .raycast import Direction


@dataclass(frozen=True)
class Entry:
    """Un point d'entrée : la case juste à l'extérieur du plateau d'où un
    rayon est tiré, et la direction dans laquelle il entre."""

    position: Position
    direction: Direction


class LabelScheme:
    """Traduit les libellés du livret ("15", "I", ...) en `Entry`."""

    def __init__(self, dimensions: BoardDimensions | None = None) -> None:
        dims = dimensions or BoardDimensions()
        self._label_to_entry: dict[str, Entry] = {}

        width, height = dims.width, dims.height

        # Bord haut : nombres 1..width, de gauche à droite, tir vers le bas.
        for col in range(width):
            self._label_to_entry[str(col + 1)] = Entry((col, -1), Direction.DOWN)
        # Bord bas : nombres width+1..2*width, de gauche à droite, tir vers le haut.
        for col in range(width):
            self._label_to_entry[str(width + col + 1)] = Entry((col, height), Direction.UP)
        # Bord gauche : lettres A.., de haut en bas, tir vers la droite.
        for row in range(height):
            self._label_to_entry[_letter(row)] = Entry((-1, row), Direction.RIGHT)
        # Bord droit : lettres suivantes, de haut en bas, tir vers la gauche.
        for row in range(height):
            self._label_to_entry[_letter(height + row)] = Entry((width, row), Direction.LEFT)

        self._entry_to_label = {v: k for k, v in self._label_to_entry.items()}

    def entry_for_label(self, label: str) -> Entry:
        try:
            return self._label_to_entry[label]
        except KeyError:
            raise ValueError(f"Libellé de point d'entrée inconnu : {label!r}") from None

    def label_for_entry(self, entry: Entry) -> str:
        try:
            return self._entry_to_label[entry]
        except KeyError:
            raise ValueError(f"Aucun libellé ne correspond à {entry!r}") from None

    def all_labels(self) -> list[str]:
        return list(self._label_to_entry)


def _letter(index: int) -> str:
    """0 -> 'A', 25 -> 'Z'. Suffisant pour des plateaux de taille raisonnable."""
    if not 0 <= index < 26:
        raise ValueError("Plateau trop grand pour un étiquetage A-Z simple.")
    return chr(ord("A") + index)
