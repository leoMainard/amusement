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


def piece_results(board: Board, guess: list[Piece]) -> list[tuple[Piece, bool]]:
    """Pour l'écran de résultats (retour utilisateur direct — "on verra
    l'ensemble des pièces avec marqué trouvé ou manqué") : chaque pièce
    RÉELLE du plateau, avec `True` si `guess` la retrouve exactement (même
    nature/couleur/emprise, quelque part dans la proposition), `False`
    sinon. Un `Counter` plutôt qu'un simple test d'appartenance : si
    `guess` contient deux fois la même empreinte (ne devrait pas arriver
    avec une vraie proposition, mais reste défensif), chaque exemplaire
    réel ne peut être "trouvé" qu'une fois."""
    remaining = Counter(_signature(p) for p in guess)
    results: list[tuple[Piece, bool]] = []
    for piece in board.pieces():
        sig = _signature(piece)
        found = remaining[sig] > 0
        if found:
            remaining[sig] -= 1
        results.append((piece, found))
    return results
