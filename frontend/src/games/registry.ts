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
import { orapaMineThumbnailHtml } from "./orapa-mine/thumbnail";
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
  /** Étiquette courte (ex. "Déduction") affichée à côté de `players`/
   * `duration` sur la carte d'accueil (voir `main.ts#gameCardHtml`). */
  category: string;
  players: string;
  duration: string;
  /** Contenu HTML autonome (déjà du markup, pas juste du texte) réutilisé
   * tel quel par la carte d'accueil (`.game-card__icon`) et la fiche du
   * jeu (`.om-shell__info-card-icon`) — chaque jeu fournit sa propre
   * vignette (voir `orapa-mine/thumbnail.ts`), `main.ts` ne connaît
   * toujours aucun jeu par son nom. */
  thumbnailHtml: string;
  mountNotice: MountView;
  mountGuide: MountView;
  mountDemo: MountView;
  mountMultiplayer: MountView;
}

export const GAMES: readonly GameDescriptor[] = [
  {
    id: "orapa_mine",
    title: "Orapa Mine",
    description: "Un jeu de déduction. Envoyez des rayons dans le gisement adverse et devinez où sont cachées les cinq gemmes.",
    category: "Déduction",
    players: "1-5 joueurs",
    duration: "10-30 min",
    thumbnailHtml: orapaMineThumbnailHtml(),
    mountNotice: mountOrapaMineNotice,
    mountGuide: mountOrapaMineGuide,
    mountDemo: mountOrapaMineDemo,
    mountMultiplayer: mountOrapaMineMultiplayer,
  },
];
