/**
 * Port TypeScript de `geometry.py` (mêmes règles, voir sa docstring) :
 * chaque case est divisée en 4 quartiers triangulaires (N/E/S/W) pour
 * représenter exactement les demi-cases, en arithmétique entière
 * (aucun flottant) — pour la démo hors ligne uniquement (voir
 * `preview-engine.ts`).
 */

export type Quadrant = "N" | "E" | "S" | "W";
export type Point = readonly [x: number, y: number];
export type QuadrantKey = string; // `${col},${row},${quadrant}`

const QUADRANT_PROBE: Record<Quadrant, Point> = {
  N: [2, 1],
  E: [3, 2],
  S: [2, 3],
  W: [1, 2],
};

const SAME_CELL_NEIGHBORS: Record<Quadrant, readonly [Quadrant, Quadrant]> = {
  N: ["E", "W"],
  E: ["N", "S"],
  S: ["E", "W"],
  W: ["N", "S"],
};

const CROSS_CELL_NEIGHBOR: Record<Quadrant, { quadrant: Quadrant; delta: Point }> = {
  N: { quadrant: "S", delta: [0, -1] },
  S: { quadrant: "N", delta: [0, 1] },
  E: { quadrant: "W", delta: [1, 0] },
  W: { quadrant: "E", delta: [-1, 0] },
};

export function quadrantKey(col: number, row: number, quadrant: Quadrant): QuadrantKey {
  return `${col},${row},${quadrant}`;
}

export function pointInConvexPolygon(point: Point, vertices: readonly Point[]): boolean {
  let sign = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    const cross = (x2 - x1) * (point[1] - y1) - (y2 - y1) * (point[0] - x1);
    if (cross === 0) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = currentSign;
    else if (currentSign !== sign) return false;
  }
  return true;
}

export function polygonToQuadrants(vertices: readonly Point[]): Set<QuadrantKey> {
  const scaled: Point[] = vertices.map(([x, y]) => [4 * x, 4 * y]);
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const result = new Set<QuadrantKey>();
  for (let col = minX; col < maxX; col++) {
    for (let row = minY; row < maxY; row++) {
      for (const quadrant of Object.keys(QUADRANT_PROBE) as Quadrant[]) {
        const [dx, dy] = QUADRANT_PROBE[quadrant];
        const probe: Point = [4 * col + dx, 4 * row + dy];
        if (pointInConvexPolygon(probe, scaled)) {
          result.add(quadrantKey(col, row, quadrant));
        }
      }
    }
  }
  return result;
}

export function polygonEdges(vertices: readonly Point[]): Array<[Point, Point]> {
  const n = vertices.length;
  const edges: Array<[Point, Point]> = [];
  for (let i = 0; i < n; i++) {
    edges.push([vertices[i], vertices[(i + 1) % n]]);
  }
  return edges;
}

export function edgeAdjacentNeighbors(col: number, row: number, quadrant: Quadrant): QuadrantKey[] {
  const neighbors = SAME_CELL_NEIGHBORS[quadrant].map((q) => quadrantKey(col, row, q));
  const { quadrant: otherQuadrant, delta } = CROSS_CELL_NEIGHBOR[quadrant];
  neighbors.push(quadrantKey(col + delta[0], row + delta[1], otherQuadrant));
  return neighbors;
}
