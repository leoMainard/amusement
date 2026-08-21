/** Génère la galerie de toutes les combinaisons de couleurs possibles
 * (mélange d'un rayon), avec leur résultat — partagée entre la notice
 * (`pages/notice/orapa-mine.ts`) et le panneau d'aide en jeu/en guide
 * (`help-panel.ts`), pour ne documenter ces 15 combinaisons qu'une
 * seule fois. */

import { resolveRayColorName } from "./colors";
import { pieceIconSvg } from "./piece-icon";
import { rayColorStyle } from "./color-swatch";
import { Color, PieceShape } from "./types";

// Une silhouette représentative par couleur, pour illustrer les
// mélanges — n'importe quelle gemme de cette couleur ferait l'affaire,
// le rayon ne se soucie que de la couleur touchée, pas de la forme.
const COMBO_SHAPE_BY_COLOR: Record<Color, PieceShape> = {
  RED: PieceShape.PARALLELOGRAM,
  YELLOW: PieceShape.MEDIUM_TRIANGLE,
  BLUE: PieceShape.LARGE_TRIANGLE,
  WHITE: PieceShape.RHOMBUS,
};

const ALL_COLORS: readonly Color[] = [Color.RED, Color.YELLOW, Color.BLUE, Color.WHITE];

/** Toutes les combinaisons non vides des 4 couleurs (2^4 - 1 = 15),
 * regroupées par nombre de couleurs touchées — soit littéralement
 * « toutes les combinaisons » de mélange possibles au jeu. Rendu en
 * `<li class="notice__combo">`, à placer dans un
 * `<ul class="notice__combo-gallery">`. */
export function colorComboGalleryHtml(): string {
  const combos: Color[][] = [];
  for (let mask = 1; mask < 1 << ALL_COLORS.length; mask++) {
    const combo = ALL_COLORS.filter((_, i) => mask & (1 << i));
    combos.push(combo);
  }
  combos.sort((a, b) => a.length - b.length);

  return combos.map((combo) => colorComboCard(combo)).join("");
}

function colorComboCard(combo: readonly Color[]): string {
  const resultName = resolveRayColorName(new Set(combo));
  const icons = combo.map((color) => pieceIconSvg(COMBO_SHAPE_BY_COLOR[color], color, 34)).join("");
  // Les gemmes touchées sont déjà visibles via leurs icônes : pas besoin
  // de les répéter en toutes lettres dans la pastille (qui n'a la place
  // que pour un nom court).
  const displayName = resultName.startsWith("mélange non documenté") ? "non documenté" : resultName;
  return `
    <li class="notice__combo">
      <div class="notice__combo-top">
        <div class="notice__combo-pieces">${icons}</div>
        <span class="notice__combo-arrow">→</span>
      </div>
      <span class="notice__combo-result" style="${rayColorStyle(resultName)}">${displayName}</span>
    </li>`;
}
