/**
 * ⚠️ Moteur de jeu ré-implémenté côté client, pour la SEULE démo hors
 * ligne de la Phase 3 (voir demo.ts). Ce n'est PAS la source de vérité
 * du jeu : en mode Duel/Fouille multijoueur (Phase 4), les positions de
 * pièces ne doivent jamais transiter en clair vers le navigateur d'un
 * adversaire, et tout tir de rayon doit être résolu côté serveur par
 * `amusement.engine.orapa_mine` (Python) — sans quoi un joueur pourrait
 * lire la solution directement dans le code/état JS de la page.
 *
 * Port direct de `board.py` + `geometry.py` + `raycast.py` (mêmes
 * règles, même arithmétique entière à l'échelle ×2/×4 — voir leurs
 * docstrings pour le détail) : uniquement pour prévisualiser le plateau
 * localement. Toute la logique faisant foi reste
 * `src/amusement/engine/orapa_mine/` côté Python.
 */

import { type Point, type Quadrant, type QuadrantKey, edgeAdjacentNeighbors, polygonEdges, polygonToQuadrants } from "./geometry";
import { placeShape } from "./piece-shapes";
import { resolveRayColorName } from "./colors";
import { type BoardDimensions, type Color, type Direction, GemKind, type Piece } from "./types";

export class PlacementError extends Error {}

export class PreviewBoard {
  readonly dimensions: BoardDimensions;
  private placedPieces: Piece[] = [];
  private occupancy = new Map<QuadrantKey, Piece>();

  constructor(dimensions: BoardDimensions) {
    this.dimensions = dimensions;
  }

  contains([col, row]: Point): boolean {
    return col >= 0 && col < this.dimensions.width && row >= 0 && row < this.dimensions.height;
  }

  pieces(): Piece[] {
    return [...this.placedPieces];
  }

  vertices(piece: Piece): Point[] {
    return placeShape(piece.shape, piece.origin, piece.rotationSteps, piece.mirrored);
  }

  quadrants(piece: Piece): Set<QuadrantKey> {
    return polygonToQuadrants(this.vertices(piece));
  }

  pieceAtCell([col, row]: Point): Piece | undefined {
    for (const quadrant of ["N", "E", "S", "W"] as Quadrant[]) {
      const piece = this.occupancy.get(`${col},${row},${quadrant}`);
      if (piece) return piece;
    }
    return undefined;
  }

  /** Lève `PlacementError` si le placement viole une règle du livret. */
  placePiece(piece: Piece): void {
    const quadrants = this.quadrants(piece);
    this.validatePlacement(quadrants);
    this.placedPieces.push(piece);
    for (const key of quadrants) this.occupancy.set(key, piece);
  }

  removePiece(piece: Piece): void {
    const quadrants = this.quadrants(piece);
    for (const key of quadrants) this.occupancy.delete(key);
    this.placedPieces = this.placedPieces.filter((p) => p !== piece);
  }

  /** Pour le retour visuel pendant le placement, sans lever d'exception. */
  canPlace(piece: Piece): boolean {
    try {
      this.validatePlacement(this.quadrants(piece));
      return true;
    } catch {
      return false;
    }
  }

  private validatePlacement(quadrants: Set<QuadrantKey>): void {
    if (quadrants.size === 0) {
      throw new PlacementError("La pièce ne couvre aucune case.");
    }
    for (const key of quadrants) {
      const [colStr, rowStr] = key.split(",");
      if (!this.contains([Number(colStr), Number(rowStr)])) {
        throw new PlacementError(`${key} est hors du plateau.`);
      }
      if (this.occupancy.has(key)) {
        throw new PlacementError(`${key} est déjà occupée.`);
      }
    }
    for (const key of quadrants) {
      const [colStr, rowStr, quadrant] = key.split(",");
      const col = Number(colStr);
      const row = Number(rowStr);
      for (const neighbor of edgeAdjacentNeighbors(col, row, quadrant as Quadrant)) {
        if (quadrants.has(neighbor)) continue;
        if (this.occupancy.has(neighbor)) {
          throw new PlacementError(
            `La pièce toucherait une autre pièce par un bord entier en ${neighbor} ` +
              "(les pièces ne peuvent se toucher que par un point).",
          );
        }
      }
    }
  }
}

// --- Lancer de rayon (port de raycast.py) ---------------------------------

const AXIS: Record<Direction, "x" | "y"> = { UP: "y", DOWN: "y", LEFT: "x", RIGHT: "x" };
const SIGN: Record<Direction, 1 | -1> = { UP: -1, DOWN: 1, LEFT: -1, RIGHT: 1 };
const REVERSE: Record<Direction, Direction> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

const DIAGONAL_REFLECTION: Record<-1 | 1, Record<Direction, Direction>> = {
  "-1": { RIGHT: "UP", UP: "RIGHT", LEFT: "DOWN", DOWN: "LEFT" },
  "1": { RIGHT: "DOWN", DOWN: "RIGHT", LEFT: "UP", UP: "LEFT" },
};

function toScaled([col, row]: Point): Point {
  return [2 * col + 1, 2 * row + 1];
}

function fromScaledExit([x, y]: Point): Point {
  return [Math.floor(x / 2), Math.floor(y / 2)];
}

export interface RayStep {
  /** Position réelle (peut être fractionnaire : un rebond à 180° a lieu
   * sur le bord d'une case, pas nécessairement en son centre) — utile
   * telle quelle pour tracer le rayon en 3D, voir `board-scene.ts`. */
  position: Point;
  direction: Direction;
}

export interface RayResult {
  path: RayStep[]; // toutes les positions traversées, entrée -> sortie
  exit: Point | null; // null si absorbé
  exitDirection: Direction | null; // null si absorbé
  colorsTouched: Set<Color>;
  colorName: string;
  absorbed: boolean;
}

interface Hit {
  distance: number;
  point: Point;
  piece: Piece | null; // null = sortie par le bord du plateau
  diagonalSign: -1 | 1 | null; // null = arête droite (rebond 180°)
}

export function fireRayPreview(board: PreviewBoard, entry: Point, direction: Direction): RayResult {
  if (board.contains(entry)) {
    throw new Error(`${entry} est à l'intérieur du plateau : ce n'est pas un point d'entrée valide.`);
  }

  let position = toScaled(entry);
  let currentDirection = direction;
  const touched = new Set<Color>();
  const path: RayStep[] = [];
  const maxSteps = (board.dimensions.width + board.dimensions.height) * 4 + 8;

  for (let i = 0; i < maxSteps; i++) {
    const hit = nextEvent(board, position, currentDirection);
    path.push({ position: toRenderPoint(hit.point), direction: currentDirection });

    if (!hit.piece) {
      const exit = fromScaledExit(hit.point);
      return {
        path,
        exit,
        exitDirection: currentDirection,
        colorsTouched: touched,
        colorName: resolveRayColorName(touched),
        absorbed: false,
      };
    }

    if (hit.piece.kind === GemKind.BLACK_BODY) {
      return { path, exit: null, exitDirection: null, colorsTouched: touched, colorName: "absorbé", absorbed: true };
    }
    if (hit.piece.kind === GemKind.NORMAL && hit.piece.color) {
      touched.add(hit.piece.color);
    }

    position = hit.point;
    currentDirection = hit.diagonalSign === null ? REVERSE[currentDirection] : DIAGONAL_REFLECTION[hit.diagonalSign][currentDirection];
  }

  throw new Error("Boucle de réflexions détectée : le rayon ne sort jamais.");
}

function toRenderPoint([x, y]: Point): Point {
  // Simple mise à l'échelle inverse (÷2), sans arrondi : un rebond à
  // 180° a lieu pile sur le bord d'une case (coordonnée entière), une
  // déviation à 90° a lieu en son centre (coordonnée X.5) — les deux
  // sont des positions réelles valables pour le tracé du rayon.
  return [x / 2, y / 2];
}

export function peek(board: PreviewBoard, pos: Point): string {
  const piece = board.pieceAtCell(pos);
  if (!piece) return "Rien";
  if (piece.kind === GemKind.DIAMOND) return "Un diamant";
  if (piece.kind === GemKind.BLACK_BODY) return "Un corps noir";
  const label: Record<Color, string> = { RED: "rouge", YELLOW: "jaune", BLUE: "bleue", WHITE: "blanche" };
  return `Une gemme ${label[piece.color as Color]}`;
}

function nextEvent(board: PreviewBoard, position: Point, direction: Direction): Hit {
  const axis = AXIS[direction];
  const sign = SIGN[direction];
  const boardEdge = boardEdgeScaled(board, direction, position);

  let best: Hit = {
    distance: signedDistance(boardEdge, position, axis, sign),
    point: boardEdge,
    piece: null,
    diagonalSign: null,
  };

  for (const piece of board.pieces()) {
    const vertices = board.vertices(piece).map(([x, y]) => [2 * x, 2 * y] as Point);
    for (const [start, end] of polygonEdges(vertices)) {
      const candidate = edgeCrossing(position, direction, start, end);
      if (!candidate) continue;
      const [point, diagonalSign] = candidate;
      const distance = signedDistance(point, position, axis, sign);
      if (distance <= 0) continue;
      if (distance <= best.distance) {
        best = { distance, point, piece, diagonalSign };
      }
    }
  }

  return best;
}

function signedDistance(point: Point, position: Point, axis: "x" | "y", sign: number): number {
  const moving = axis === "x" ? 0 : 1;
  return sign * (point[moving] - position[moving]);
}

function boardEdgeScaled(board: PreviewBoard, direction: Direction, position: Point): Point {
  let [x, y] = position;
  if (direction === "RIGHT") x = 2 * board.dimensions.width;
  else if (direction === "LEFT") x = -1;
  else if (direction === "DOWN") y = 2 * board.dimensions.height;
  else if (direction === "UP") y = -1;
  return [x, y];
}

function edgeCrossing(position: Point, direction: Direction, p1: Point, p2: Point): [Point, -1 | 1 | null] | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;

  if (AXIS[direction] === "x") {
    const fixed = position[1];
    if (y1 === y2) return null;
    if (!(Math.min(y1, y2) < fixed && fixed < Math.max(y1, y2))) return null;
    if (x1 === x2) return [[x1, fixed], null];
    const diagonalSign: -1 | 1 = x2 - x1 > 0 === y2 - y1 > 0 ? 1 : -1;
    const xHit = x1 + (fixed - y1) * diagonalSign;
    return [[xHit, fixed], diagonalSign];
  } else {
    const fixed = position[0];
    if (x1 === x2) return null;
    if (!(Math.min(x1, x2) < fixed && fixed < Math.max(x1, x2))) return null;
    if (y1 === y2) return [[fixed, y1], null];
    const diagonalSign: -1 | 1 = x2 - x1 > 0 === y2 - y1 > 0 ? 1 : -1;
    const yHit = y1 + (fixed - x1) * diagonalSign;
    return [[fixed, yHit], diagonalSign];
  }
}
