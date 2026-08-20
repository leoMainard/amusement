/** Lookup générique d'un salon par son code, indépendant de tout jeu —
 * sert uniquement à savoir à quel jeu appartient un lien `?room=CODE`
 * partagé, avant de monter le bon écran (voir `main.ts`). Le reste du
 * protocole (placement, questions...) reste dans
 * `games/<id>/protocol.ts`, propre à chaque jeu. */

import { API_BASE_URL } from "./config";

export interface RoomInfo {
  code: string;
  game: string;
}

/** `null` si le salon n'existe pas (code invalide/périmé) ou en cas
 * d'erreur réseau — l'appelant décide alors d'un repli raisonnable. */
export async function fetchRoomInfo(code: string): Promise<RoomInfo | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/rooms/${code}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
