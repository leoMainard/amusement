"""Déroulement d'une partie en mode Fouille (placement aléatoire).

Deux variantes, choisies à la création de la partie (voir docs/plan.md) :

- PARALLEL_PRIVATE : chaque joueur interroge sa propre instance du
  plateau caché (même génération pour tous, généralement via
  `generation.random_board`), sans contrainte de tour — les joueurs
  jouent en parallèle, à leur rythme.
- TURN_BASED : un plateau commun, questions/réponses tour par tour,
  reprenant la variante 3+ joueurs officielle du livret.

Dans les deux cas : le premier joueur à soumettre une solution complète
et correcte gagne immédiatement. Une proposition erronée n'élimine pas
son auteur tout de suite — comme dans la variante 3+ joueurs officielle,
il faut une SECONDE proposition erronée pour être éliminé. Si tous les
joueurs sont éliminés, personne ne gagne.

(Ce comportement de pénalité est le défaut retenu ; c'est encore une
décision produit ouverte — voir docs/plan.md.)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto

from .board import Board, Piece, Position
from .borders import LabelScheme
from .raycast import RayResult, fire_ray, peek
from .solution import check_solution


class FouilleMode(Enum):
    PARALLEL_PRIVATE = auto()
    TURN_BASED = auto()


class FouilleError(RuntimeError):
    """Levée pour toute action invalide (joueur éliminé, mauvais tour...)."""


@dataclass
class FouilleGame:
    board: Board  # plateau généré une fois, partagé par tous les joueurs
    players: tuple[str, ...]
    mode: FouilleMode = FouilleMode.PARALLEL_PRIVATE
    label_scheme: LabelScheme = field(default_factory=LabelScheme)

    finished: bool = field(default=False, init=False)
    winner: str | None = field(default=None, init=False)
    _wrong_attempts: dict[str, int] = field(init=False)
    eliminated: set[str] = field(default_factory=set, init=False)
    _turn_index: int = field(default=0, init=False)  # TURN_BASED uniquement

    def __post_init__(self) -> None:
        if len(self.players) < 2:
            raise ValueError("Il faut au moins 2 joueurs.")
        self._wrong_attempts = {p: 0 for p in self.players}

    def current_turn_player(self) -> str | None:
        """Le joueur dont c'est le tour (TURN_BASED uniquement, sinon None)."""
        if self.mode != FouilleMode.TURN_BASED:
            return None
        active = [p for p in self.players if p not in self.eliminated]
        if not active:
            return None
        return active[self._turn_index % len(active)]

    def _require_can_play(self, player: str) -> None:
        if self.finished:
            raise FouilleError("La partie est terminée.")
        if player in self.eliminated:
            raise FouilleError(f"{player} est éliminé.")
        if self.mode == FouilleMode.TURN_BASED and player != self.current_turn_player():
            raise FouilleError(f"Ce n'est pas le tour de {player}.")

    def _advance_turn(self) -> None:
        if self.mode == FouilleMode.TURN_BASED:
            self._turn_index += 1

    def ask_ray(self, player: str, entry_label: str) -> RayResult:
        self._require_can_play(player)
        entry = self.label_scheme.entry_for_label(entry_label)
        result = fire_ray(self.board, entry.position, entry.direction)
        self._advance_turn()
        return result

    def ask_peek(self, player: str, position: Position) -> str:
        self._require_can_play(player)
        result = peek(self.board, position)
        self._advance_turn()
        return result

    def submit_solution(self, player: str, guess: list[Piece]) -> None:
        self._require_can_play(player)

        if check_solution(self.board, guess):
            self.finished = True
            self.winner = player
            return

        self._wrong_attempts[player] += 1
        if self._wrong_attempts[player] >= 2:
            self.eliminated.add(player)
        self._advance_turn()

        remaining = [p for p in self.players if p not in self.eliminated]
        if not remaining:
            self.finished = True  # tout le monde a perdu : pas de gagnant
