"""Moteur de règles d'Orapa Mine — logique pure, indépendante de tout
framework web (voir chaque sous-module pour le détail et les hypothèses
documentées) :

- `colors` : couleurs de base et règles de mélange du rayon.
- `geometry` : géométrie exacte (quartiers de case, contact par un point).
- `pieces` : les 5 silhouettes de gemmes et leur placement (rotation/miroir).
- `board` : plateau, pièces posées, validation de placement.
- `raycast` : lancer de rayon, réflexions (diagonale = 90°, bord droit = 180°), question ponctuelle.
- `borders` : conversion libellés du livret <-> points d'entrée.
- `generation` : génération aléatoire d'un plateau valide (mode Fouille).
- `solution` : vérification d'une proposition de solution.
- `duel` : déroulement d'une partie en mode Duel (2 joueurs, règles officielles).
- `fouille` : déroulement d'une partie en mode Fouille (placement
  aléatoire, tour par tour, jouable seul ou à plusieurs).

Reste à faire (Phase 3+ du plan) : rendu 3D et interactions à jour avec
ces silhouettes réelles, couche multijoueur temps réel (salons,
WebSocket) au-dessus de ces classes de jeu.
"""

from .board import Board, BoardDimensions, GemKind, PlacementError, Piece, Position
from .borders import Entry, LabelScheme
from .colors import Color, resolve_ray_color
from .duel import DuelError, DuelGame, LogEntry
from .fouille import FouilleError, FouilleGame
from .generation import BASE_PIECE_SET, EXTENSION_PIECE_SET, PieceSpec, random_board
from .geometry import Quadrant
from .pieces import PieceShape
from .raycast import Direction, RayResult, fire_ray, peek
from .solution import check_solution, piece_results

__all__ = [
    "Board",
    "BoardDimensions",
    "Piece",
    "GemKind",
    "PieceShape",
    "Quadrant",
    "PlacementError",
    "Position",
    "Entry",
    "LabelScheme",
    "Color",
    "resolve_ray_color",
    "Direction",
    "RayResult",
    "fire_ray",
    "peek",
    "BASE_PIECE_SET",
    "EXTENSION_PIECE_SET",
    "PieceSpec",
    "random_board",
    "check_solution",
    "piece_results",
    "DuelGame",
    "DuelError",
    "LogEntry",
    "FouilleGame",
    "FouilleError",
]
