"""Déroulement d'une partie en mode Fouille (placement aléatoire).

Un plateau généré une fois (voir `generation.random_board`), inconnu de
tous, exploré tour par tour — reprend la variante 3+ joueurs officielle
du livret. Jouable seul (un seul joueur : c'est alors toujours son
tour) tout comme à plusieurs. Comme en Duel, un « tour » est une fenêtre
de temps (voir `amusement.api.game_session.DEFAULT_TURN_DURATION_SECONDS`),
pas une action unique : `ask_ray`/`ask_peek` ne la font plus avancer
(retour utilisateur direct — poser une question ne doit pas coûter son
tour) ; seule `pass_turn` (bouton "Terminer mon tour", ou expiration du
chrono côté serveur) ou une proposition de solution la font avancer.

Le premier joueur à soumettre une solution complète et correcte gagne
immédiatement. Une proposition erronée n'élimine pas son auteur tout de
suite : il faut une SECONDE proposition erronée pour être éliminé. Si
tous les joueurs sont éliminés, personne ne gagne.

(Ce comportement de pénalité est le défaut retenu ; c'est encore une
décision produit ouverte — voir docs/plan.md.)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .board import Board, Piece, Position
from .borders import LabelScheme
from .raycast import RayResult, fire_ray, peek
from .solution import check_solution


class FouilleError(RuntimeError):
    """Levée pour toute action invalide (joueur éliminé, mauvais tour...)."""


@dataclass
class FouilleGame:
    board: Board  # plateau généré une fois, partagé par tous les joueurs
    players: tuple[str, ...]
    label_scheme: LabelScheme = field(default_factory=LabelScheme)

    finished: bool = field(default=False, init=False)
    winner: str | None = field(default=None, init=False)
    _wrong_attempts: dict[str, int] = field(init=False)
    eliminated: set[str] = field(default_factory=set, init=False)
    _turn_index: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        if len(self.players) < 1:
            raise ValueError("Il faut au moins 1 joueur.")
        self._wrong_attempts = {p: 0 for p in self.players}

    def current_turn_player(self) -> str | None:
        """Le joueur dont c'est le tour (`None` si tout le monde est
        éliminé). Avec un seul joueur, c'est toujours son tour."""
        active = [p for p in self.players if p not in self.eliminated]
        if not active:
            return None
        return active[self._turn_index % len(active)]

    def _require_can_play(self, player: str) -> None:
        if self.finished:
            raise FouilleError("La partie est terminée.")
        if player in self.eliminated:
            raise FouilleError(f"{player} est éliminé.")
        if player != self.current_turn_player():
            raise FouilleError(f"Ce n'est pas le tour de {player}.")

    def _advance_turn(self) -> None:
        self._turn_index += 1

    def ask_ray(self, player: str, entry_label: str) -> RayResult:
        # Ne fait plus avancer le tour (voir docstring du module) :
        # plusieurs questions peuvent être posées pendant le même tour.
        self._require_can_play(player)
        entry = self.label_scheme.entry_for_label(entry_label)
        return fire_ray(self.board, entry.position, entry.direction)

    def ask_peek(self, player: str, position: Position) -> str:
        self._require_can_play(player)
        return peek(self.board, position)

    def pass_turn(self, player: str) -> None:
        """Termine volontairement le tour de `player` sans poser de
        question — bouton "Terminer mon tour" côté client, ou forcé par
        le serveur quand le chrono de tour expire (voir
        `amusement.api.game_session`)."""
        self._require_can_play(player)
        self._advance_turn()

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
