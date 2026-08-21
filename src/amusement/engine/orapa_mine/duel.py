"""Déroulement d'une partie en mode Duel (2 joueurs, règles officielles).

Chaque joueur a son propre plateau secret ; les rôles maître du jeu /
prospecteur s'inversent à chaque tour. Un « tour » est une fenêtre de
temps (voir `amusement.api.game_session.DEFAULT_TURN_DURATION_SECONDS`),
mais reste limité à UNE SEULE question — `ask_ray` OU `ask_peek`, pas
les deux, pas deux fois la même (retour utilisateur direct : "sur un
tour, il est possible de tirer un seul rayon OU d'interroger une seule
case"). Le temps restant après cette question sert à réfléchir/
positionner ses repères, pas à enchaîner d'autres questions ; seule
`pass_turn` fait effectivement passer la main (bouton "Terminer mon
tour" côté client, ou expiration du chrono côté serveur), ce qui
réarme aussi le droit à une nouvelle question pour le tour suivant.
Règles de fin de partie reprises du livret :

- une proposition erronée fait perdre immédiatement son auteur ;
- une proposition correcte du joueur qui N'A PAS débuté la partie le
  fait gagner immédiatement ;
- une proposition correcte du joueur qui A débuté la partie ne gagne pas
  tout de suite : son adversaire a encore UN tour pour proposer à son
  tour. S'il se trompe (ou n'utilise pas ce tour pour proposer, voir
  ci-dessous), la victoire du premier joueur est confirmée. S'il devine
  juste, la partie se termine sur une égalité.

Interprétation retenue pour « il a encore un tour » : ce tour se termine
comme n'importe quel autre (`pass_turn`, volontaire ou par expiration du
chrono) — poser des questions pendant ce tour ne le consomme plus (voir
ci-dessus), mais s'il se termine sans proposition correcte, la victoire
du premier joueur est confirmée.

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
    # Une seule question par tour (voir docstring du module) — remis à
    # `False` à chaque vrai changement de tour (voir `_consume_turn` et
    # la branche correspondante de `submit_solution`).
    asked_this_turn: bool = field(default=False, init=False)
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

    def _require_question_available(self) -> None:
        if self.asked_this_turn:
            raise DuelError("Une seule question par tour : tire un rayon OU interroge une case, pas les deux.")

    def ask_ray(self, player: str, entry_label: str) -> RayResult:
        """Tire un rayon sur le plateau adverse — une seule question par
        tour (voir docstring du module), ne consomme PAS le tour lui-même
        (le temps restant sert à réfléchir, pas à enchaîner d'autres
        questions, déjà interdites)."""
        self._require_current_prospector(player)
        self._require_question_available()
        opponent_board = self.boards[self._opponent(player)]
        entry = self.label_scheme.entry_for_label(entry_label)
        result = fire_ray(opponent_board, entry.position, entry.direction)
        self.log.append(LogEntry(player, "ray", entry_label, result))
        self.asked_this_turn = True
        return result

    def ask_peek(self, player: str, position: Position) -> str:
        """Demande « qu'y a-t-il en [position] ? » — même limite d'une
        question par tour, même raison que `ask_ray`."""
        self._require_current_prospector(player)
        self._require_question_available()
        opponent_board = self.boards[self._opponent(player)]
        result = peek(opponent_board, position)
        self.log.append(LogEntry(player, "peek", position, result))
        self.asked_this_turn = True
        return result

    def replay(self, index: int) -> RayResult | str:
        """Redemande confirmation d'une réponse déjà donnée (par son
        index dans `log`), sans consommer de tour."""
        return self.log[index].result

    def pass_turn(self, player: str) -> None:
        """Termine volontairement le tour de `player` sans poser de
        question ni proposer de solution — bouton "Terminer mon tour"
        côté client, ou forcé par le serveur quand le chrono de tour
        expire (voir `amusement.api.game_session`). Consomme le tour
        exactement comme une question normale (même cas particulier de
        fin de partie, voir `_consume_turn`)."""
        self._require_current_prospector(player)
        self._consume_turn(player)

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
        self.asked_this_turn = False

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
        self.asked_this_turn = False
