/**
 * Types miroir du moteur Python (`src/amusement/engine/orapa_mine/`).
 *
 * Tenus volontairement en phase avec `board.py` / `pieces.py` /
 * `raycast.py` / `colors.py` pour que le rendu 3D et l'aperçu local
 * (Phase 3) parlent le même vocabulaire que le backend (Phase 4).
 *
 * Exception : `UNIT_SQUARE` / `UNIT_TRIANGLE` n'existent que côté
 * frontend, pour les pièces de réflexion (voir `reflection.ts`) —
 * des repères personnels posés en mode question, jamais envoyés au
 * serveur, donc sans équivalent côté moteur Python.
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
  TENT: "TENT", // emprise du Diamant / Corps noir : 2 demi-cases, pointe vers le haut
  UNIT_SQUARE: "UNIT_SQUARE", // frontend uniquement — voir la docstring du module
  UNIT_TRIANGLE: "UNIT_TRIANGLE", // frontend uniquement — voir la docstring du module
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

/** Couleurs d'affichage (hexadécimal Three.js) pour chaque `Color` —
 * reprises de la maquette Claude Design (`claude_design/orapa-board.js`,
 * table `PIECES`). Le blanc est un vrai crème (`#f7f4ee`), pas blanc
 * pur : reste lisible sur le fond bleu nuit du plateau sans avoir
 * besoin d'être éclatant. */
export const GEM_DISPLAY_COLOR: Record<Color, number> = {
  RED: 0xd8443c,
  YELLOW: 0xf2c24b,
  BLUE: 0x2f6fd0,
  WHITE: 0xf7f4ee,
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

/** Les deux extensions (voir la notice) : optionnelles, pas comptées
 * dans les "5 gemmes" à poser pour valider un placement. Emprise `TENT` :
 * 2 demi-cases accolées par leur hypoténuse, pointe vers le haut. */
export const EXTENSION_PIECE_PALETTE: ReadonlyArray<{ shape: PieceShape; kind: GemKind; label: string }> = [
  { shape: PieceShape.TENT, kind: GemKind.DIAMOND, label: "Diamant" },
  { shape: PieceShape.TENT, kind: GemKind.BLACK_BODY, label: "Corps noir" },
];

const COLOR_LABEL: Record<Color, string> = {
  RED: "rouge",
  YELLOW: "jaune",
  BLUE: "bleu",
  WHITE: "blanc",
};

/** Repères de réflexion (voir `reflection.ts`) : une case entière ou une
 * demi-case, dans chacune des 4 couleurs — de quoi esquisser « je pense
 * qu'il y a du rouge par ici » sans devoir choisir une silhouette
 * complète (parallélogramme, triangle...). Purement local, jamais
 * envoyé au serveur. */
export const REFLECTION_UNIT_PALETTE: ReadonlyArray<{ shape: PieceShape; color: Color; label: string }> = (
  [Color.RED, Color.YELLOW, Color.BLUE, Color.WHITE] as const
).flatMap((color) => [
  { shape: PieceShape.UNIT_SQUARE, color, label: `Case ${COLOR_LABEL[color]}` },
  { shape: PieceShape.UNIT_TRIANGLE, color, label: `Demi-case ${COLOR_LABEL[color]}` },
]);
