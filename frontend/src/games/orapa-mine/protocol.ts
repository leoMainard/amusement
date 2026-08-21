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
  eliminated?: string[];
  // communs
  finished?: boolean;
  winner?: string | null;
  /** Horodatage Unix (secondes, éventuellement fractionnaires) de fin du
   * tour en cours — `null`/absent si non chronométré (salon à un seul
   * joueur, ou hors partie). Voir `OrapaMineSession.turn_deadline`. */
  turn_deadline?: number | null;
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

export function sendRemovePiece(socket: RoomSocket, position: Position): void {
  socket.send({ type: "remove_piece", position });
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
