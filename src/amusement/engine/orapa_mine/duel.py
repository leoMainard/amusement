"""Déroulement d'une partie en mode Duel (2 joueurs, règles officielles).

Chaque joueur a son propre plateau secret ; les rôles maître du jeu /
prospecteur s'inversent à chaque tour. Règles de fin de partie reprises
du livret :

- une proposition erronée fait perdre immédiatement son auteur ;
- une proposition correcte du joueur qui N'A PAS débuté la partie le
  fait gagner immédiatement ;
- une proposition correcte du joueur qui A débuté la partie ne gagne pas
  tout de suite : son adversaire a encore UN tour pour proposer à son
  tour. S'il se trompe (ou n'utilise pas ce tour pour proposer, voir
  ci-dessous), la victoire du premier joueur est confirmée. S'il devine
  juste, la partie se termine sur une égalité.

Interprétation retenue pour « il a encore un tour » : si l'adversaire
utilise ce tour pour poser une question normale plutôt que de proposer
une solution, son unique chance est consommée et la victoire du premier
joueur est immédiatement confirmée (lecture stricte, à assouplir si elle
s'avère trop punitive à l'usage — voir docs/plan.md).

Demander confirmation d'une réponse déjà donnée ne consomme pas de tour
(`replay`), conformément au livret.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .board import Board, Piece, Position
from .borders import LabelScheme
from .raycast import RayResult, fire_ray, peek
from .solution import check_solution


@dataclass(frozen=True)
class LogEntry:
    asker: str
    kind: Literal["ray", "peek"]
    query: str | Position
    result: RayResult | str


class DuelError(RuntimeError):
    """Levée pour toute action invalide (mauvais tour, partie terminée...)."""


@dataclass
class DuelGame:
    players: tuple[str, str]
    boards: dict[str, Board]
    starting_player: str
    label_scheme: LabelScheme = field(default_factory=LabelScheme)

    current_prospector: str = field(init=False)
    finished: bool = field(default=False, init=False)
    winner: str | None = field(default=None, init=False)
    draw: bool = field(default=False, init=False)
    log: list[LogEntry] = field(default_factory=list, init=False)
    _awaiting_final_guess_from: str | None = field(default=None, init=False)

    def __post_init__(self) -> None:
        if self.starting_player not in self.players:
            raise ValueError("starting_player doit être l'un des deux joueurs.")
        if set(self.boards) != set(self.players):
            raise ValueError("boards doit contenir exactement un plateau par joueur.")
        self.current_prospector = self.starting_player

    def _opponent(self, player: str) -> str:
        a, b = self.players
        return b if player == a else a

    def _require_current_prospector(self, player: str) -> None:
        if self.finished:
            raise DuelError("La partie est terminée.")
        if player != self.current_prospector:
            raise DuelError(f"Ce n'est pas le tour de {player}.")

    def ask_ray(self, player: str, entry_label: str) -> RayResult:
        """Tire un rayon sur le plateau adverse ; consomme le tour."""
        self._require_current_prospector(player)
        opponent_board = self.boards[self._opponent(player)]
        entry = self.label_scheme.entry_for_label(entry_label)
        result = fire_ray(opponent_board, entry.position, entry.direction)
        self.log.append(LogEntry(player, "ray", entry_label, result))
        self._consume_turn(player)
        return result

    def ask_peek(self, player: str, position: Position) -> str:
        """Demande « qu'y a-t-il en [position] ? » ; consomme le tour."""
        self._require_current_prospector(player)
        opponent_board = self.boards[self._opponent(player)]
        result = peek(opponent_board, position)
        self.log.append(LogEntry(player, "peek", position, result))
        self._consume_turn(player)
        return result

    def replay(self, index: int) -> RayResult | str:
        """Redemande confirmation d'une réponse déjà donnée (par son
        index dans `log`), sans consommer de tour."""
        return self.log[index].result

    def _consume_turn(self, player: str) -> None:
        if self._awaiting_final_guess_from == player:
            # L'adversaire du premier joueur avait un unique tour pour
            # proposer une solution ; il ne l'a pas fait (question
            # normale à la place) : la victoire du premier joueur est
            # confirmée (voir docstring du module).
            self.finished = True
            self.winner = self._opponent(player)
            return
        self.current_prospector = self._opponent(self.current_prospector)

    def submit_solution(self, player: str, guess: list[Piece]) -> None:
        """Utilise le tour de prospecteur de `player` pour soumettre une
        proposition complète du plateau adverse."""
        self._require_current_prospector(player)
        opponent = self._opponent(player)
        correct = check_solution(self.boards[opponent], guess)

        if self._awaiting_final_guess_from == player:
            self.finished = True
            if correct:
                self.draw = True
            else:
                self.winner = opponent  # = starting_player
            return

        if not correct:
            self.finished = True
            self.winner = opponent
            return

        if player != self.starting_player:
            self.finished = True
            self.winner = player
            return

        # Le joueur qui a débuté devine juste en premier : l'adversaire a
        # encore un tour pour proposer à son tour.
        self.current_prospector = opponent
        self._awaiting_final_guess_from = opponent
