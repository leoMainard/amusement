/**
 * Port TypeScript de `pieces.py` : les 5 silhouettes réelles des gemmes
 * (voir sa docstring pour la provenance de chaque forme), en
 * coordonnées locales canoniques, plus leur placement (rotation par pas
 * de 90°, miroir optionnel, translation).
 */

import type { Point } from "./geometry";
import { PieceShape } from "./types";

const CANONICAL_VERTICES: Record<PieceShape, readonly Point[]> = {
  [PieceShape.MEDIUM_TRIANGLE]: [
    [0, 0],
    [2, 0],
    [0, 2],
  ],
  [PieceShape.PARALLELOGRAM]: [
    [0, 0],
    [2, 0],
    [3, 1],
    [1, 1],
  ],
  [PieceShape.RHOMBUS]: [
    [1, 0],
    [2, 1],
    [1, 2],
    [0, 1],
  ],
  [PieceShape.LARGE_TRIANGLE]: [
    [0, 0],
    [2, 2],
    [0, 4],
  ],
  [PieceShape.TENT]: [
    [0, 1],
    [2, 1],
    [1, 0],
  ],
};

function rotate90([x, y]: Point): Point {
  return [-y, x];
}

function mirrorX([x, y]: Point): Point {
  return [-x, y];
}

export function placeShape(
  shape: PieceShape,
  origin: Point,
  rotationSteps: number = 0,
  mirrored: boolean = false,
): Point[] {
  let vertices: Point[] = [...CANONICAL_VERTICES[shape]];

  if (mirrored) {
    vertices = vertices.map(mirrorX);
  }

  const steps = ((rotationSteps % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    vertices = vertices.map(rotate90);
  }

  const minX = Math.min(...vertices.map(([x]) => x));
  const minY = Math.min(...vertices.map(([, y]) => y));
  const [originCol, originRow] = origin;
  return vertices.map(([x, y]) => [x - minX + originCol, y - minY + originRow]);
}
