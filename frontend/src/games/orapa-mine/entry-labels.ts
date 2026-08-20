/** Retrouve le libellé du livret (ex : "13") correspondant à un point
 * de sortie de rayon, plutôt que d'afficher des coordonnées brutes —
 * c'est ainsi que le jeu physique désigne toujours une case du
 * pourtour. Un point de sortie est toujours aussi un point d'entrée
 * valide, mais avec la direction opposée (on sort dans le sens
 * inverse de celui dans lequel on serait entré à cet endroit). */

import { type Direction, DEFAULT_DIMENSIONS, type Position } from "./types";
import { LabelScheme } from "./borders";

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

const defaultScheme = new LabelScheme(DEFAULT_DIMENSIONS);

export function labelForExit(position: Position, direction: Direction, scheme: LabelScheme = defaultScheme): string {
  try {
    return scheme.labelForEntry({ position, direction: OPPOSITE_DIRECTION[direction] });
  } catch {
    // Filet de sécurité : ne devrait pas arriver, une sortie est
    // toujours un point d'entrée valide vu dans l'autre sens.
    return `(${position[0]}, ${position[1]})`;
  }
}

/** Désigne une case INTÉRIEURE (pas un point du pourtour, voir
 * `labelForExit` pour ça) par une combinaison lettre+chiffre façon
 * Bataille navale — colonne en lettre (A, B, C...), ligne en chiffre à
 * partir de 1 — plutôt que des coordonnées brutes (col, row), pas
 * lisibles pour un joueur (retour utilisateur direct). Utilisé pour
 * répondre à « qu'y a-t-il en [case] ? ». */
export function cellLabel([col, row]: Position): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}
