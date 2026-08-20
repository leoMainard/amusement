/**
 * Port TypeScript de `colors.py` (mêmes règles et mêmes hypothèses
 * documentées côté Python) : nom de la couleur de sortie du rayon selon
 * l'ensemble des couleurs de gemme touchées.
 */

import { type Color } from "./types";

// Ordre canonique utilisé pour construire une clé de recherche stable
// (Python utilise un frozenset, non ordonné par nature ; ici on trie
// simplement selon cet ordre fixe avant de rechercher dans les tables).
const CANONICAL_ORDER: Color[] = ["RED", "YELLOW", "BLUE", "WHITE"];

const SINGLE_NAME: Record<Color, string> = {
  RED: "rouge",
  YELLOW: "jaune",
  BLUE: "bleu",
  WHITE: "blanc",
};

const PAIR_MIX: Record<string, string> = {
  "RED,WHITE": "rose",
  "YELLOW,WHITE": "jaune clair",
  "BLUE,WHITE": "bleu clair",
  "RED,YELLOW": "orange",
  "YELLOW,BLUE": "vert",
  "RED,BLUE": "violet",
};

const TRIPLE_WITH_WHITE_MIX: Record<string, string> = {
  "RED,BLUE,WHITE": "violet clair",
  "YELLOW,BLUE,WHITE": "vert clair",
  "RED,YELLOW,WHITE": "orange clair",
};

export function resolveRayColorName(touched: ReadonlySet<Color>): string {
  if (touched.size === 0) return "transparent";

  const sorted = CANONICAL_ORDER.filter((c) => touched.has(c));
  if (sorted.length === 1) return SINGLE_NAME[sorted[0]];
  if (sorted.length === 4) return "gris";
  if (sorted.length === 3 && sorted.join(",") === "RED,YELLOW,BLUE") return "noir";

  const key = sorted.join(",");
  if (sorted.length === 2 && key in PAIR_MIX) return PAIR_MIX[key];
  if (sorted.length === 3 && key in TRIPLE_WITH_WHITE_MIX) return TRIPLE_WITH_WHITE_MIX[key];

  // Les 15 combinaisons possibles sont couvertes ci-dessus (voir
  // colors.py) : ce point ne devrait jamais être atteint.
  throw new Error(`Combinaison de couleurs inattendue : ${sorted.join(", ")}`);
}
