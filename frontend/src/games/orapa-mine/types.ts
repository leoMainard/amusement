/**
 * Types miroir du moteur Python (`src/amusement/engine/orapa_mine/`).
 *
 * Tenus volontairement en phase avec `board.py` / `pieces.py` /
 * `raycast.py` / `colors.py` pour que le rendu 3D et l'aperçu local
 * (Phase 3) parlent le même vocabulaire que le backend (Phase 4).
 */

export type Position = readonly [col: number, row: number];

export const Color = {
  RED: "RED",
  YELLOW: "YELLOW",
  BLUE: "BLUE",
  WHITE: "WHITE",
} as const;
export type Color = (typeof Color)[keyof typeof Color];

export const PieceShape = {
  MEDIUM_TRIANGLE: "MEDIUM_TRIANGLE", // jaune : 1 carré + 2 triangles
  PARALLELOGRAM: "PARALLELOGRAM", // rouge : 1 carré + 2 triangles
  RHOMBUS: "RHOMBUS", // blanc : 4 triangles
  LARGE_TRIANGLE: "LARGE_TRIANGLE", // blanc ou bleu : 2 carrés + 4 triangles
  SQUARE: "SQUARE", // emprise du Diamant / Corps noir (hypothèse — voir docs/plan.md)
} as const;
export type PieceShape = (typeof PieceShape)[keyof typeof PieceShape];

export const GemKind = {
  NORMAL: "NORMAL",
  DIAMOND: "DIAMOND",
  BLACK_BODY: "BLACK_BODY",
} as const;
export type GemKind = (typeof GemKind)[keyof typeof GemKind];

export interface Piece {
  shape: PieceShape;
  kind: GemKind;
  color?: Color; // requis pour NORMAL uniquement
  origin: Position;
  rotationSteps: number; // 0-3, pas de 90°
  mirrored: boolean;
}

export interface BoardDimensions {
  width: number;
  height: number;
}

export const DEFAULT_DIMENSIONS: BoardDimensions = { width: 9, height: 9 };

export const Direction = {
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Couleurs d'affichage (hexadécimal Three.js) pour chaque `Color`. Le
 * blanc reste un vrai blanc (pas grisé) : sa lisibilité sur le fond
 * clair du plateau vient du contour sombre ajouté à chaque pièce en 3D
 * (voir `board-scene.ts`), pas d'une teinte approximative. */
export const GEM_DISPLAY_COLOR: Record<Color, number> = {
  RED: 0xd64545,
  YELLOW: 0xe0c23c,
  BLUE: 0x3f7fd6,
  WHITE: 0xffffff,
};

/** Les 5 silhouettes de la variante de base, avec leur couleur/nature —
 * même composition que `generation.BASE_PIECE_SET` côté backend. */
export const BASE_PIECE_PALETTE: ReadonlyArray<{ shape: PieceShape; color: Color; label: string }> = [
  { shape: PieceShape.PARALLELOGRAM, color: Color.RED, label: "Parallélogramme rouge" },
  { shape: PieceShape.MEDIUM_TRIANGLE, color: Color.YELLOW, label: "Triangle rectangle jaune" },
  { shape: PieceShape.LARGE_TRIANGLE, color: Color.BLUE, label: "Grand triangle bleu" },
  { shape: PieceShape.RHOMBUS, color: Color.WHITE, label: "Losange blanc" },
  { shape: PieceShape.LARGE_TRIANGLE, color: Color.WHITE, label: "Grand triangle blanc" },
];
