/** Traduction des messages WebSocket d'un salon Orapa Mine — miroir
 * exact de `src/amusement/api/game_ws.py` et `game_session.py` côté
 * serveur. Tenu synchronisé à la main (pas de génération de schéma
 * partagé pour l'instant — voir docs/plan.md). */

import { API_BASE_URL } from "../../lib/config";
import type { RoomSocket } from "../../lib/room-socket";
import type { Direction, Piece, Position } from "./types";

export type RoomMode = "DUEL" | "FOUILLE";
export type RoomStatus = "LOBBY" | "PLACING" | "PLAYING" | "FINISHED";

export interface RoomPlayer {
  id: string;
  name: string;
}

export interface RoomPayload {
  code: string;
  game: string;
  mode: RoomMode;
  max_players: number;
  status: RoomStatus;
  extensions_enabled: boolean;
  players: RoomPlayer[];
}

export interface GameStatePayload {
  // Duel
  current_prospector?: string;
  draw?: boolean;
  // Fouille
  current_turn_player?: string | null;
  // communs — Duel et Fouille appliquent tous deux la règle des deux
  // essais (retour utilisateur direct, voir duel.py/fouille.py) : la
  // liste des joueurs qui ont épuisé leurs deux essais et ne peuvent
  // plus gagner (mais la partie continue pour les autres).
  eliminated?: string[];
  finished?: boolean;
  winner?: string | null;
  /** Horodatage Unix (secondes, éventuellement fractionnaires) de fin du
   * tour en cours — `null`/absent si non chronométré (salon à un seul
   * joueur, ou hors partie). Voir `OrapaMineSession.turn_deadline`. */
  turn_deadline?: number | null;
  /** Une seule question (rayon OU case) par tour — voir `duel.py`/
   * `fouille.py`. `true` une fois la question du tour posée : le client
   * désactive "Tirer un rayon"/"Interroger une case" jusqu'au tour
   * suivant, plutôt que de laisser l'utilisateur découvrir le refus
   * après coup. */
  asked_this_turn?: boolean;
}

/** Écran de résultats (retour utilisateur direct) : envoyé une seule
 * fois, au moment où la partie se termine (voir `game_ws.py`) — le
 * client garde ces données pour "revoir la révélation" sans redemander
 * au serveur. Miroir de `OrapaMineSession.results_payload`. */
export interface GameResultsPayload {
  mode: RoomMode;
  players: RoomPlayer[];
  winner: string | null;
  /** Nombre total de questions (rayon + case) posées pendant la partie,
   * tous joueurs confondus. */
  questions: number;
  /** Duel seulement. */
  draw?: boolean;
  /** Duel seulement : `boards[playerId]` décrit le plateau RÉEL de
   * `playerId`, et comment son UNIQUE adversaire (2 joueurs en Duel)
   * s'en est sorti à le deviner — `guess`/`found` sont donc la dernière
   * proposition de l'ADVERSAIRE contre CE plateau, pas celle de
   * `playerId` lui-même. */
  boards?: Record<string, { board: Record<string, unknown>[]; found: boolean[]; guess: Record<string, unknown>[]; found_count: number }>;
  /** Fouille seulement : un seul plateau partagé. */
  board?: Record<string, unknown>[];
  /** Fouille seulement : `results[playerId]` = la dernière proposition
   * de `playerId` contre `board` ci-dessus, et ce qu'elle a trouvé. */
  results?: Record<string, { guess: Record<string, unknown>[]; found: boolean[]; found_count: number }>;
}

export interface RayResultPayload {
  entry: Position;
  entry_direction: Direction;
  exit: Position | null;
  exit_direction: Direction | null;
  color: string;
  absorbed: boolean;
}

export async function createRoom(mode: RoomMode, maxPlayers: number, extensionsEnabled: boolean = false): Promise<RoomPayload> {
  const response = await fetch(`${API_BASE_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "orapa_mine", mode, max_players: maxPlayers, extensions_enabled: extensionsEnabled }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "Impossible de créer le salon.");
  }
  return response.json();
}

export function piecePayload(piece: Piece): Record<string, unknown> {
  return {
    shape: piece.shape,
    kind: piece.kind,
    color: piece.color ?? null,
    origin: piece.origin,
    rotation_steps: piece.rotationSteps,
    mirrored: piece.mirrored,
  };
}

export function pieceFromPayload(payload: Record<string, unknown>): Piece {
  return {
    shape: payload.shape as Piece["shape"],
    kind: payload.kind as Piece["kind"],
    color: (payload.color as Piece["color"] | null) ?? undefined,
    origin: payload.origin as Position,
    rotationSteps: (payload.rotation_steps as number) ?? 0,
    mirrored: Boolean(payload.mirrored),
  };
}

export function sendPlacePiece(socket: RoomSocket, piece: Piece): void {
  socket.send({ type: "place_piece", piece: piecePayload(piece) });
}

/** Décrit `piece` en entier (forme/couleur/origine/rotation/miroir),
 * pas juste sa position : `origin` marque le coin de la boîte
 * englobante de la pièce, pas nécessairement une case qu'elle occupe
 * réellement une fois posée (ex. le losange) — un retrait par simple
 * position pouvait donc échouer à tort selon la rotation/le miroir
 * (retour utilisateur direct, repéré via "Au hasard"). Voir
 * `OrapaMineSession.remove_piece` côté serveur. */
export function sendRemovePiece(socket: RoomSocket, piece: Piece): void {
  socket.send({ type: "remove_piece", piece: piecePayload(piece) });
}

export function sendValidatePlacement(socket: RoomSocket): void {
  socket.send({ type: "validate_placement" });
}

export function sendAskRay(socket: RoomSocket, entryLabel: string): void {
  socket.send({ type: "ask_ray", entry_label: entryLabel });
}

export function sendAskPeek(socket: RoomSocket, position: Position): void {
  socket.send({ type: "ask_peek", position });
}

export function sendSubmitSolution(socket: RoomSocket, guess: Piece[]): void {
  socket.send({ type: "submit_solution", guess: guess.map(piecePayload) });
}

/** Bouton "Terminer mon tour" : passe la main volontairement sans poser
 * de question ni proposer — même effet que l'expiration du chrono côté
 * serveur (voir `turn_deadline`). */
export function sendEndTurn(socket: RoomSocket): void {
  socket.send({ type: "end_turn" });
}
