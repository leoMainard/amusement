/** Rendu visuel d'un nom de couleur de rayon (voir `colors.ts` /
 * `board-scene.ts:RAY_COLOR_HEX`) sous forme de pastille colorée —
 * partagé entre la notice (mélanges d'exemple) et tout affichage de
 * résultat (démo, guide, multijoueur), pour que "rouge" ait exactement
 * la même couleur partout sur le site. */

import { RAY_COLOR_HEX } from "./board-scene";

export function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

// Texte clair sur les teintes sombres/saturées (bleu, rouge, violet...),
// texte sombre sur les teintes claires — luminance relative approximée.
export function contrastingTextColor(n: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#f5f5f0";
}

/** `background:...;color:...` prêt à mettre dans un attribut `style`. */
export function rayColorStyle(name: string): string {
  const hex = RAY_COLOR_HEX[name] ?? 0x999999;
  return `background:${hexColor(hex)};color:${contrastingTextColor(hex)}`;
}

/** Un `<span>` autonome portant la couleur `name` — pour insérer
 * directement dans un message texte (ex : le journal multijoueur). */
export function colorBadgeHtml(name: string): string {
  return `<span class="ray-color-badge" style="${rayColorStyle(name)}">${name}</span>`;
}

// Luminance relative approximée — voir `contrastingTextColor`. En
// dessous de ce seuil, une couleur (ex. "noir") serait quasi invisible
// écrite en texte sur le fond bleu nuit très sombre de la page : le
// texte retombe alors sur `var(--om-text)`, la petite case colorée
// (voir `colorSquareHtml`) reste seule à porter la teinte exacte.
const MIN_TEXT_LUMINANCE = 0.25;

function isTooDarkForText(n: number): boolean {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < MIN_TEXT_LUMINANCE;
}

/** Petite case carrée de la couleur `name` — le "témoin" visuel avant
 * le nom de couleur en toutes lettres (voir `colorNameHtml`), pour
 * l'historique simplifié du multijoueur (retour utilisateur direct :
 * l'ancien texte "couleur [pastille]" était trop verbeux). */
export function colorSquareHtml(name: string): string {
  const hex = RAY_COLOR_HEX[name] ?? 0x999999;
  return `<span class="ray-color-square" style="background:${hexColor(hex)}" title="${name}"></span>`;
}

/** Nom de couleur en majuscules, écrit dans sa propre teinte (texte
 * coloré directement, pas une pastille à fond plein comme
 * `colorBadgeHtml`) — à utiliser après `colorSquareHtml`. */
export function colorNameHtml(name: string): string {
  const hex = RAY_COLOR_HEX[name] ?? 0x999999;
  const textColor = isTooDarkForText(hex) ? "var(--om-text)" : hexColor(hex);
  return `<span class="ray-color-name" style="color:${textColor}">${name.toUpperCase()}</span>`;
}
