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

Règles de fin de partie (retour utilisateur direct — alignées sur le
mode Fouille, "peu importe le mode de jeu, je peux faire deux
propositions") :

- une proposition correcte fait gagner immédiatement son auteur ;
- une proposition erronée ne fait PAS perdre tout de suite : il faut se
  tromper deux fois pour être éliminé (`eliminated`) — définitivement
  incapable de gagner, mais peut continuer à poser des questions
  (purement pour le plaisir/la déduction, voir `_require_current_prospector`
  — en pratique bloqué aussi, comme en Fouille : un joueur éliminé ne
  peut plus rien faire) ;
- soumettre une proposition (juste ou fausse) termine le tour de son
  auteur, comme `pass_turn` — SAUF si elle est juste (la partie est
  alors terminée, plus de tour à donner) ;
- une fois l'un des deux éliminé, l'autre garde la main en continu (il
  n'y a que 2 joueurs, personne d'autre à qui passer le relai) ;
- si les deux sont éliminés, la partie se termine sur une égalité
  (`draw`) — ni l'un ni l'autre n'a trouvé.
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
    # `False` à chaque vrai changement de tour (voir `_consume_turn`).
    asked_this_turn: bool = field(default=False, init=False)
    _wrong_attempts: dict[str, int] = field(init=False)
    eliminated: set[str] = field(default_factory=set, init=False)
    # Dernière proposition soumise par chaque joueur (voir l'écran de
    # résultats, `OrapaMineSession.results_payload`) — écrasée à chaque
    # nouvel essai, seule la plus récente compte pour l'affichage.
    last_guess: dict[str, list[Piece]] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        if self.starting_player not in self.players:
            raise ValueError("starting_player doit être l'un des deux joueurs.")
        if set(self.boards) != set(self.players):
            raise ValueError("boards doit contenir exactement un plateau par joueur.")
        self.current_prospector = self.starting_player
        self._wrong_attempts = {p: 0 for p in self.players}

    def _opponent(self, player: str) -> str:
        a, b = self.players
        return b if player == a else a

    def _require_current_prospector(self, player: str) -> None:
        if self.finished:
            raise DuelError("La partie est terminée.")
        if player in self.eliminated:
            raise DuelError(f"{player} est éliminé.")
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
        expire (voir `amusement.api.game_session`)."""
        self._require_current_prospector(player)
        self._consume_turn(player)

    def _consume_turn(self, player: str) -> None:
        self.asked_this_turn = False
        opponent = self._opponent(player)
        # Une fois l'un des deux éliminé, l'autre garde la main en continu
        # (voir docstring du module) : alterner reviendrait sinon à
        # donner la main à un joueur qui ne peut plus rien faire, ce qui
        # bloquerait la partie.
        self.current_prospector = player if opponent in self.eliminated else opponent

    def submit_solution(self, player: str, guess: list[Piece]) -> None:
        """Utilise le tour de prospecteur de `player` pour soumettre une
        proposition complète du plateau adverse — voir les règles de fin
        de partie dans la docstring du module."""
        self._require_current_prospector(player)
        opponent = self._opponent(player)
        self.last_guess[player] = guess
        correct = check_solution(self.boards[opponent], guess)

        if correct:
            self.finished = True
            self.winner = player
            return

        self._wrong_attempts[player] += 1
        if self._wrong_attempts[player] >= 2:
            self.eliminated.add(player)
        self._consume_turn(player)

        if len(self.eliminated) == len(self.players):
            self.finished = True
            self.draw = True
