/**
 * Registre des jeux du portail (Phase 6 du plan) : chaque jeu déclare
 * son identité (id — doit correspondre à `Room.game` côté backend) et
 * ses 4 écrans standard (notice, guide, démo hors ligne, jeu en ligne).
 * `main.ts` ne connaît plus aucun jeu par son nom : il se contente
 * d'itérer `GAMES` pour construire la page d'accueil et le routage
 * `?room=CODE`. Ajouter un futur jeu ne touche donc que ce fichier
 * (plus ses propres modules sous `games/<id>/`, et sous `pages/notice/`
 * et `pages/guide/` pour ses pages de notice/guide).
 */

import { mountOrapaMineDemo } from "./orapa-mine/demo";
import { mountOrapaMineMultiplayer } from "./orapa-mine/multiplayer";
import { mountOrapaMineNotice } from "../pages/notice/orapa-mine";
import { mountOrapaMineGuide } from "../pages/guide/orapa-mine";

/** Un écran monte son contenu dans `root` et renvoie une fonction de
 * nettoyage (ferme les connexions, dispose la scène 3D...), appelée
 * avant de monter l'écran suivant — voir `main.ts#showView`. */
export type MountView = (root: HTMLElement) => () => void;

export interface GameDescriptor {
  /** Doit correspondre exactement à `Room.game` côté backend : c'est ce
   * qui permet de retrouver le bon jeu pour un lien `?room=CODE`
   * partagé (voir `GET /api/rooms/{code}`). */
  id: string;
  title: string;
  description: string;
  mountNotice: MountView;
  mountGuide: MountView;
  mountDemo: MountView;
  mountMultiplayer: MountView;
}

export const GAMES: readonly GameDescriptor[] = [
  {
    id: "orapa_mine",
    title: "Orapa Mine",
    description: "Plateau 3D, mode Duel et mode Fouille.",
    mountNotice: mountOrapaMineNotice,
    mountGuide: mountOrapaMineGuide,
    mountDemo: mountOrapaMineDemo,
    mountMultiplayer: mountOrapaMineMultiplayer,
  },
];
