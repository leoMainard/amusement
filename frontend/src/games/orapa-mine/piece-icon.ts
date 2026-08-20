/** Icône SVG d'une pièce, à partir de sa vraie silhouette (voir
 * `piece-shapes.ts`) — pas une pastille de couleur. Utilisé par la
 * palette de placement, la démo et la notice. */

import { placeShape } from "./piece-shapes";
import type { PieceShape } from "./types";

const FILL_BY_COLOR: Record<string, string> = {
  RED: "#d64545",
  YELLOW: "#e0c23c",
  BLUE: "#3f7fd6",
  WHITE: "#ffffff",
};

export function pieceIconSvg(shape: PieceShape, color: string, size: number = 44): string {
  const verts = placeShape(shape, [0, 0]);
  const xs = verts.map(([x]) => x);
  const ys = verts.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 0.001);
  const h = Math.max(maxY - minY, 0.001);
  const pad = 0.3;
  const viewW = w + pad * 2;
  const viewH = h + pad * 2;
  const points = verts.map(([x, y]) => `${x - minX + pad},${y - minY + pad}`).join(" ");
  const fill = FILL_BY_COLOR[color] ?? "#999";
  return `<svg viewBox="0 0 ${viewW} ${viewH}" width="${size}" height="${size}" role="img" aria-hidden="true">
    <polygon points="${points}" fill="${fill}" stroke="#3b3a35" stroke-width="0.06" />
  </svg>`;
}
