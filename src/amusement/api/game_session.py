"""Relie un `Room` au moteur de jeu Orapa Mine (DuelGame / FouilleGame),
et traduit les messages WebSocket (dicts JSON) en appels au moteur.

Reste volontairement séparé de la couche transport (`game_ws.py`) pour
rester testable sans WebSocket réel.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from amusement.engine.orapa_mine import (
    BASE_PIECE_SET,
    EXTENSION_PIECE_SET,
    Board,
    BoardDimensions,
    Color,
    DuelGame,
    FouilleGame,
    GemKind,
    LabelScheme,
    Piece,
    PieceShape,
    Position,
    piece_results,
    random_board,
)
from amusement.rooms.room import Room, RoomError, RoomMode, RoomStatus

# Durée d'un tour avant qu'il ne soit terminé automatiquement côté
# serveur (voir `OrapaMineSession.turn_deadline`/`end_turn`, et la
# boucle d'arrière-plan dans `game_ws.py`) — retour utilisateur direct :
# "chaque tour dure 4 min".
DEFAULT_TURN_DURATION_SECONDS = 240.0


def piece_from_payload(payload: dict) -> Piece:
    try:
        shape = PieceShape[payload["shape"]]
        kind = GemKind[payload.get("kind", "NORMAL")]
        color = Color[payload["color"]] if payload.get("color") else None
        origin = tuple(payload["origin"])
        rotation_steps = int(payload.get("rotation_steps", 0))
        mirrored = bool(payload.get("mirrored", False))
    except (KeyError, ValueError, TypeError) as exc:
        raise RoomError(f"Pièce invalide : {exc}") from exc
    return Piece(shape=shape, kind=kind, color=color, origin=origin, rotation_steps=rotation_steps, mirrored=mirrored)


def piece_to_payload(piece: Piece) -> dict:
    return {
        "shape": piece.shape.name,
        "kind": piece.kind.name,
        "color": piece.color.name if piece.color else None,
        "origin": list(piece.origin),
        "rotation_steps": piece.rotation_steps,
        "mirrored": piece.mirrored,
    }


def _piece_key(piece: Piece) -> tuple:
    # `kind` doit faire partie de la clé : le Diamant et le Corps noir
    # ont tous deux `shape=TENT` et `color=None`, donc (shape, color)
    # seul les confondrait — poser l'un rendrait l'autre injustement
    # "déjà posé".
    return (piece.shape, piece.kind, piece.color)


@dataclass
class PendingPlacement:
    """Plateau en cours de constitution par un joueur, en mode Duel,
    avant validation (voir `OrapaMineSession.place_piece`)."""

    board: Board
    used: set[tuple] = field(default_factory=set)
    ready: bool = False


class OrapaMineSession:
    """État de partie associé à un salon Orapa Mine."""

    def __init__(
        self,
        room: Room,
        dimensions: BoardDimensions | None = None,
        turn_duration_seconds: float = DEFAULT_TURN_DURATION_SECONDS,
    ) -> None:
        self.room = room
        self.dimensions = dimensions or BoardDimensions()
        self.label_scheme = LabelScheme(self.dimensions)
        self.placements: dict[str, PendingPlacement] = {}
        self.duel: DuelGame | None = None
        self.fouille: FouilleGame | None = None
        # Réglable (voir tests) : la boucle d'arrière-plan de game_ws.py
        # attend ce délai sans action avant de terminer le tour en cours
        # automatiquement.
        self.turn_duration_seconds = turn_duration_seconds
        # Horodatage Unix de l'échéance du tour EN COURS (voir
        # `_reset_turn_timer`/`end_turn`) — `None` tant qu'il n'y a pas de
        # tour à chronométrer (hors PLAYING, partie terminée, ou salon à
        # un seul joueur : personne à presser, voir docs/plan.md).
        self.turn_deadline: float | None = None

    # --- démarrage, selon le mode du salon --------------------------------

    def start(self) -> None:
        """Appelé quand le salon est complet : lance la phase adaptée."""
        if self.room.mode == RoomMode.DUEL:
            self.placements = {p.id: PendingPlacement(board=Board(self.dimensions)) for p in self.room.players}
            self.room.status = RoomStatus.PLACING
        else:
            pieces = BASE_PIECE_SET + EXTENSION_PIECE_SET if self.room.extensions_enabled else BASE_PIECE_SET
            board = random_board(self.dimensions, pieces)
            players = tuple(p.id for p in self.room.players)
            self.fouille = FouilleGame(board=board, players=players, label_scheme=self.label_scheme)
            self.room.status = RoomStatus.PLAYING
            self._reset_turn_timer()

    # --- Duel : placement ---------------------------------------------------

    def place_piece(self, player_id: str, piece: Piece) -> None:
        pending = self._pending_for(player_id)
        if piece.kind != GemKind.NORMAL and not self.room.extensions_enabled:
            raise RoomError("Les pièces d'extension (Diamant, Corps noir) ne sont pas activées pour ce salon.")
        key = _piece_key(piece)
        if key in pending.used:
            raise RoomError("Cette pièce a déjà été posée.")
        pending.board.place_piece(piece)  # peut lever PlacementError
        pending.used.add(key)

    def remove_piece(self, player_id: str, piece: Piece) -> None:
        """Retire `piece` (description complète — forme/couleur/origine/
        rotation/miroir), pas une simple position. Un retrait PAR CASE
        cliquée (`board.piece_at_cell`) semblait plus simple, mais une
        case donnée n'est pas toujours couverte par la pièce dont c'est
        pourtant l'origine (`origin` marque le coin de la boîte
        englobante, pas nécessairement un quartier réellement occupé —
        ex. le losange, dont aucun sommet ne tombe sur ce coin) : pour
        certaines rotations/miroirs, retirer par position sur `origin`
        échouait donc à tort avec « Aucune pièce à cet endroit » — bug
        réel, retour utilisateur direct (repéré via « Au hasard », qui
        tire des rotations/miroirs aléatoires bien plus souvent qu'un
        placement manuel). La correspondance EXACTE (`Piece` est un
        dataclass gelé, comparé par valeur) élimine ce problème de
        géométrie entièrement plutôt que de le contourner au cas par cas.
        """
        pending = self._pending_for(player_id)
        if piece not in pending.board.pieces():
            raise RoomError("Aucune pièce à cet endroit.")
        pending.board.remove_piece(piece)
        pending.used.discard(_piece_key(piece))

    def validate_placement(self, player_id: str) -> bool:
        """Renvoie True si tous les joueurs sont prêts (la partie démarre)."""
        pending = self._pending_for(player_id)
        if len(pending.used) < len(BASE_PIECE_SET):
            raise RoomError(f"Placement incomplet ({len(pending.used)}/{len(BASE_PIECE_SET)} pièces).")
        pending.ready = True
        if all(p.ready for p in self.placements.values()):
            self._start_duel()
            return True
        return False

    def _pending_for(self, player_id: str) -> PendingPlacement:
        if self.room.status != RoomStatus.PLACING:
            raise RoomError("Ce n'est pas la phase de placement.")
        pending = self.placements.get(player_id)
        if pending is None:
            raise RoomError("Joueur inconnu pour ce salon.")
        if pending.ready:
            raise RoomError("Placement déjà validé : plus de modification possible.")
        return pending

    def _start_duel(self) -> None:
        players = tuple(p.id for p in self.room.players)
        boards = {pid: pending.board for pid, pending in self.placements.items()}
        starting_player = players[0]  # ordre d'arrivée — tirage au sort réel à ajouter côté UI
        self.duel = DuelGame(players=players, boards=boards, starting_player=starting_player, label_scheme=self.label_scheme)
        self.room.status = RoomStatus.PLAYING
        self._reset_turn_timer()

    # --- jeu : questions/réponses, commun aux deux modes ---------------------

    @property
    def _active_game(self) -> DuelGame | FouilleGame:
        game = self.duel if self.room.mode == RoomMode.DUEL else self.fouille
        if game is None:
            raise RoomError("La partie n'a pas encore démarré.")
        return game

    def ask_ray(self, player_id: str, entry_label: str):
        # Ne touche plus au chrono (voir duel.py/fouille.py) : poser une
        # question ne consomme plus le tour, donc ne le relance pas non
        # plus — un tour reste une fenêtre de temps fixe, pas prolongée
        # par chaque question posée dedans (retour utilisateur direct).
        return self._active_game.ask_ray(player_id, entry_label)

    def ask_peek(self, player_id: str, position: Position) -> str:
        return self._active_game.ask_peek(player_id, tuple(position))

    def submit_solution(self, player_id: str, guess_payload: list[dict]) -> None:
        guess = [piece_from_payload(p) for p in guess_payload]
        self._active_game.submit_solution(player_id, guess)
        if self._active_game.finished:
            self.room.status = RoomStatus.FINISHED
        self._after_turn_action()

    def results_payload(self) -> dict:
        """Assemble tout ce qu'il faut pour l'écran de résultats (retour
        utilisateur direct) une fois la partie terminée : plateau(x)
        réel(s), dernière proposition de chaque joueur, et quelles
        pièces ont été trouvées/manquées. Diffusé une seule fois par
        `game_ws.py` au moment où la partie se termine ; le client garde
        ces données pour "revoir la révélation" sans redemander au
        serveur. Ne doit être appelé qu'une fois la partie terminée
        (avant, les plateaux adverses sont encore secrets)."""
        names = {p.id: p.name for p in self.room.players}
        players_payload = [{"id": pid, "name": names.get(pid, pid)} for pid in names]

        if self.room.mode == RoomMode.DUEL:
            game = self.duel
            assert game is not None
            boards: dict[str, dict] = {}
            for player_id, board in game.boards.items():
                opponent_id = next(pid for pid in game.players if pid != player_id)
                opponent_guess = game.last_guess.get(opponent_id, [])
                pairs = piece_results(board, opponent_guess)
                boards[player_id] = {
                    "board": [piece_to_payload(p) for p, _ in pairs],
                    "found": [found for _, found in pairs],
                    "guess": [piece_to_payload(p) for p in opponent_guess],
                    "found_count": sum(1 for _, found in pairs if found),
                }
            return {
                "mode": "DUEL",
                "players": players_payload,
                "winner": game.winner,
                "draw": game.draw,
                "boards": boards,
                "questions": len(game.log),
            }

        game = self.fouille
        assert game is not None
        players_results: dict[str, dict] = {}
        for player_id in game.players:
            guess = game.last_guess.get(player_id, [])
            pairs = piece_results(game.board, guess)
            players_results[player_id] = {
                "guess": [piece_to_payload(p) for p in guess],
                "found": [found for _, found in pairs],
                "found_count": sum(1 for _, found in pairs if found),
            }
        return {
            "mode": "FOUILLE",
            "players": players_payload,
            "winner": game.winner,
            "board": [piece_to_payload(p) for p in game.board.pieces()],
            "results": players_results,
            "questions": game.questions_asked,
        }

    def end_turn(self, player_id: str) -> None:
        """Termine volontairement le tour de `player_id` sans poser de
        question ni proposer — bouton "Terminer mon tour" côté client,
        ou forcé par le serveur quand `turn_deadline` expire sans action
        (voir la boucle d'arrière-plan dans `game_ws.py`). Lève la même
        erreur qu'une action normale hors tour."""
        self._active_game.pass_turn(player_id)
        self._after_turn_action()

    @property
    def current_player_id(self) -> str | None:
        """Le joueur dont c'est le tour, tous modes confondus — `None`
        si la partie n'a pas démarré, ou si personne ne peut plus jouer
        (tout le monde éliminé en Fouille). Sert à savoir qui presser
        quand `turn_deadline` expire (voir game_ws.py)."""
        if self.room.mode == RoomMode.DUEL:
            return self.duel.current_prospector if self.duel else None
        return self.fouille.current_turn_player() if self.fouille else None

    def _reset_turn_timer(self) -> None:
        """(Re)démarre le chrono du tour EN COURS — appelé au lancement
        de la partie et après chaque action qui le fait potentiellement
        basculer (voir `_after_turn_action`). Désactivé (`None`) hors
        PLAYING, partie terminée, ou salon à un seul joueur : personne
        d'autre à presser (retour utilisateur direct — "lorsqu'il y a
        plusieurs joueurs")."""
        game = self.duel if self.room.mode == RoomMode.DUEL else self.fouille
        if self.room.status != RoomStatus.PLAYING or game is None or game.finished or len(self.room.players) < 2:
            self.turn_deadline = None
            return
        self.turn_deadline = time.time() + self.turn_duration_seconds

    def _after_turn_action(self) -> None:
        self._reset_turn_timer()
