/** Icône SVG d'une pièce, à partir de sa vraie silhouette (voir
 * `piece-shapes.ts`) — pas une pastille de couleur. Utilisé par la
 * palette de placement, la démo et la notice. */

import { placeShape } from "./piece-shapes";
import { GemKind, type PieceShape } from "./types";

// Mêmes hex que `types.ts:GEM_DISPLAY_COLOR` (source : maquette Claude
// Design, `claude_design/orapa-board.js`).
const FILL_BY_COLOR: Record<string, string> = {
  RED: "#d8443c",
  YELLOW: "#f2c24b",
  BLUE: "#2f6fd0",
  WHITE: "#f7f4ee",
};

// Le Diamant et le Corps noir n'ont pas de `color` (voir types.ts) :
// leur icône se distingue par nature plutôt que par couleur.
const FILL_BY_KIND: Partial<Record<GemKind, string>> = {
  [GemKind.DIAMOND]: "#bfe3f0",
  [GemKind.BLACK_BODY]: "#0b1330",
};

export function pieceIconSvg(
  shape: PieceShape,
  color: string | undefined,
  size: number = 44,
  kind: GemKind = GemKind.NORMAL,
  rotationSteps: number = 0,
  mirrored: boolean = false,
): string {
  const verts = placeShape(shape, [0, 0], rotationSteps, mirrored);
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
  const fill = FILL_BY_KIND[kind] ?? (color ? (FILL_BY_COLOR[color] ?? "#999") : "#999");
  const dash = kind === GemKind.DIAMOND ? ' stroke-dasharray="0.08 0.08"' : "";
  return `<svg viewBox="0 0 ${viewW} ${viewH}" width="${size}" height="${size}" role="img" aria-hidden="true">
    <polygon points="${points}" fill="${fill}" stroke="#0b1330" stroke-width="0.07"${dash} />
  </svg>`;
}
