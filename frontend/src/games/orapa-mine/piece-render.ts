/** Sommets d'une pièce placée, pour le rendu — découplé de `PreviewBoard`
 * pour que `board-scene.ts` (pur rendu) n'ait pas besoin de connaître
 * l'état de jeu, seulement la géométrie. */

import type { Point } from "./geometry";
import { placeShape } from "./piece-shapes";
import type { Piece } from "./types";

export function vertices(piece: Piece): Point[] {
  return placeShape(piece.shape, piece.origin, piece.rotationSteps, piece.mirrored);
}
