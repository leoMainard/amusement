/** Vignette illustrative (4 vraies gemmes du jeu) — partagée entre la
 * fiche du jeu (`.om-shell__info-card-icon`) et la carte d'accueil
 * (`.game-card__icon`) : retour utilisateur direct, remplace les
 * anciennes formes géométriques génériques (triangles/parallélogramme
 * décoratifs, sans rapport avec les vraies pièces). Même contenu dans
 * les deux contextes ; seul le style (taille, dégradé de fond) change
 * selon le conteneur — voir style.css. */

import { pieceIconSvg } from "./piece-icon";
import { Color, GemKind, PieceShape } from "./types";

// 4 des 5 gemmes de base (voir `types.ts:BASE_PIECE_PALETTE`) : une de
// chaque couleur plutôt que les 5 exactes (qui auraient inclus deux
// blancs) — juste une vignette illustrative, pas la vraie composition
// du jeu.
const THUMBNAIL_PIECES: ReadonlyArray<{ shape: PieceShape; color: Color }> = [
  { shape: PieceShape.RHOMBUS, color: Color.WHITE },
  { shape: PieceShape.LARGE_TRIANGLE, color: Color.BLUE },
  { shape: PieceShape.PARALLELOGRAM, color: Color.RED },
  { shape: PieceShape.MEDIUM_TRIANGLE, color: Color.YELLOW },
];

export function orapaMineThumbnailHtml(size: number = 60): string {
  return THUMBNAIL_PIECES.map(
    (p) => `<span class="orapa-thumb-piece">${pieceIconSvg(p.shape, p.color, size, GemKind.NORMAL)}</span>`,
  ).join("");
}
