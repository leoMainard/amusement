"""Vérification d'une proposition de solution contre le plateau réel."""

from __future__ import annotations

from collections import Counter

from .board import Board, Piece


def _signature(piece: Piece) -> tuple:
    """Une pièce est caractérisée par sa nature/couleur et l'emprise
    exacte qu'elle recouvre — pas par ses paramètres bruts de placement
    (origine/rotation/miroir), qui ne sont pas uniques : une même
    silhouette peut être obtenue par plusieurs combinaisons différentes
    (ex: un losange a une symétrie de rotation). Comparer les empreintes
    évite de rejeter à tort une proposition géométriquement correcte."""
    return (piece.kind, piece.color, frozenset(piece.quadrants()))


def check_solution(board: Board, guess: list[Piece]) -> bool:
    """True si `guess` décrit exactement le contenu du plateau : les
    mêmes pièces (nature, couleur), chacune à la même position exacte
    (y compris son orientation, puisqu'une gemme mal orientée dévierait
    le rayon différemment)."""
    return Counter(_signature(p) for p in board.pieces()) == Counter(_signature(p) for p in guess)
