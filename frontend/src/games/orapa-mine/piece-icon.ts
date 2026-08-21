/** Icône SVG d'une pièce, à partir de sa vraie silhouette (voir
 * `piece-shapes.ts`) — pas une pastille de couleur. Une facette
 * intérieure (silhouette resserrée vers son centre) et un dégradé sur
 * le contour donnent un relief taillé plutôt qu'un simple aplat de
 * couleur — pour lire comme une gemme, pas une forme géométrique plate
 * (retour utilisateur direct). Utilisé par la palette de placement, la
 * démo et la notice. */

import { placeShape } from "./piece-shapes";
import { GemKind, type PieceShape } from "./types";

// Mêmes hex que `types.ts:GEM_DISPLAY_COLOR` (source : maquette Claude
// Design, `claude_design/orapa-board.js`).
const FILL_BY_COLOR: Record<string, string> = {
  RED: "#e83c30",
  YELLOW: "#f2c24b",
  BLUE: "#2f7ff0",
  WHITE: "#ffffff",
};

// Le Diamant et le Corps noir n'ont pas de `color` (voir types.ts) :
// leur icône se distingue par nature plutôt que par couleur.
const FILL_BY_KIND: Partial<Record<GemKind, string>> = {
  [GemKind.DIAMOND]: "#bfe3f0",
  [GemKind.BLACK_BODY]: "#0b1330",
};

// Identifiant de dégradé unique par icône : plusieurs icônes cohabitent
// sur la même page (palette, notice...), un `id` de `<linearGradient>`
// répété entre plusieurs `<svg>` inline se réutiliserait à tort.
let gradientCounter = 0;

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
  const shifted = verts.map(([x, y]) => [x - minX + pad, y - minY + pad] as [number, number]);
  const points = shifted.map(([x, y]) => `${x},${y}`).join(" ");

  const fill = FILL_BY_KIND[kind] ?? (color ? (FILL_BY_COLOR[color] ?? "#999") : "#999");
  const dash = kind === GemKind.DIAMOND ? ' stroke-dasharray="0.08 0.08"' : "";

  // Facette intérieure : le même contour resserré vers son centre (55 %
  // de la distance) — comme la "table" d'une gemme taillée, entourée
  // d'une couronne plus sombre plutôt qu'une silhouette plate.
  const cx = shifted.reduce((sum, [x]) => sum + x, 0) / shifted.length;
  const cy = shifted.reduce((sum, [, y]) => sum + y, 0) / shifted.length;
  const facet = shifted.map(([x, y]) => `${cx + (x - cx) * 0.55},${cy + (y - cy) * 0.55}`).join(" ");

  const gid = `gem-grad-${gradientCounter++}`;
  return `<svg viewBox="0 0 ${viewW} ${viewH}" width="${size}" height="${size}" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${fill}" />
        <stop offset="100%" stop-color="#0b1330" stop-opacity="0.4" />
      </linearGradient>
    </defs>
    <polygon points="${points}" fill="url(#${gid})" stroke="#0b1330" stroke-width="0.07"${dash} />
    <polygon points="${facet}" fill="${fill}" fill-opacity="0.6" stroke="#f4ead6" stroke-width="0.02" stroke-opacity="0.55" />
  </svg>`;
}
