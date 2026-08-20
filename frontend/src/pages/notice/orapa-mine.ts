/**
 * Notice d'Orapa Mine — règles reformulées avec nos propres mots et nos
 * propres schémas (voir docs/plan.md : rien n'est copié depuis le
 * livret officiel, qui reste une référence de travail non versionnée
 * dans `regles/`).
 */

import { BASE_PIECE_PALETTE, Color, EXTENSION_PIECE_PALETTE, PieceShape } from "../../games/orapa-mine/types";
import { pieceIconSvg } from "../../games/orapa-mine/piece-icon";
import { resolveRayColorName } from "../../games/orapa-mine/colors";
import { RAY_COLOR_HEX } from "../../games/orapa-mine/board-scene";

export function mountOrapaMineNotice(root: HTMLElement): () => void {
  const pieceGallery = BASE_PIECE_PALETTE.map(
    ({ shape, color, label }) => `
      <li class="notice__piece">
        ${pieceIconSvg(shape, color, 56)}
        <span>${label}</span>
      </li>`,
  ).join("");

  const extensionGallery = EXTENSION_PIECE_PALETTE.map(
    ({ shape, kind, label }) => `
      <li class="notice__piece">
        ${pieceIconSvg(shape, undefined, 56, kind)}
        <span>${label}</span>
      </li>`,
  ).join("");

  const colorCombos = colorComboGallery();

  root.innerHTML = `
    <div class="notice">
      <p class="notice__intro">
        Orapa Mine est un jeu de déduction : à l'aide de rayons envoyés à travers un plateau,
        un joueur doit reconstituer l'emplacement exact des gemmes posées par son adversaire,
        avant que celui-ci ne fasse de même avec les siennes.
      </p>

      <section class="notice__section">
        <h3>Le plateau et les gemmes</h3>
        <p>
          Le plateau est une grille de 9×9 cases. Tout autour, des points d'entrée numérotés
          (1 à 18) et lettrés (A à R) permettent de tirer un rayon depuis n'importe quel bord.
        </p>
        <p>Chaque joueur dispose de 5 gemmes, toutes différentes :</p>
        <ul class="notice__piece-gallery">${pieceGallery}</ul>
        <p class="notice__hint">
          Chaque gemme est construite à partir de cases entières et de demi-cases (une case
          coupée en diagonale) : c'est ce qui donne sa silhouette à chacune, et c'est aussi
          ce qui détermine comment un rayon rebondit dessus (voir plus bas).
        </p>
        <p>
          Deux gemmes optionnelles peuvent s'ajouter à ces 5-là (disponibles dans « Essayer le
          plateau » et « Jouer en ligne ») :
        </p>
        <ul class="notice__piece-gallery">${extensionGallery}</ul>
        <ul>
          <li><strong>Diamant</strong> : une gemme transparente. Elle dévie le rayon comme les
            autres, mais ne le teinte jamais.</li>
          <li><strong>Corps noir</strong> : absorbe le rayon, qui ne ressort nulle part
            (« signal absorbé »).</li>
        </ul>
      </section>

      <section class="notice__section">
        <h3>Placer ses gemmes</h3>
        <ul>
          <li>Une gemme se pose alignée sur la grille : ses coins tombent sur des coins de case.</li>
          <li>On peut la faire pivoter par pas de 90°, et la retourner (image miroir) — nécessaire
            pour le parallélogramme, qui n'a pas de symétrie miroir.</li>
          <li>Une gemme peut toucher le bord du plateau, mais ne peut jamais le dépasser.</li>
          <li>Deux gemmes ne peuvent se toucher que par un point, jamais partager un bord entier.</li>
        </ul>
        <div class="notice__diagram-row">
          <figure class="notice__diagram">
            ${touchDiagram(true)}
            <figcaption>Autorisé : contact par un point</figcaption>
          </figure>
          <figure class="notice__diagram">
            ${touchDiagram(false)}
            <figcaption>Interdit : contact par un bord entier</figcaption>
          </figure>
        </div>
      </section>

      <section class="notice__section">
        <h3>Le rayon</h3>
        <p>
          Depuis un point d'entrée, le rayon file en ligne droite jusqu'à heurter une gemme —
          ou jusqu'à ressortir de l'autre côté du plateau s'il n'en croise aucune.
        </p>
        <div class="notice__diagram-row">
          <figure class="notice__diagram">
            ${diagonalDiagram()}
            <figcaption>Bord en diagonale : le rayon dévie de 90°</figcaption>
          </figure>
          <figure class="notice__diagram">
            ${bounceDiagram()}
            <figcaption>Bord droit, de face : le rayon rebondit à 180° et ressort par son entrée</figcaption>
          </figure>
        </div>
        <p>
          Un rayon peut ainsi rebondir sur plusieurs gemmes avant de ressortir. On peut aussi,
          au lieu de tirer un rayon, demander directement « qu'y a-t-il en [case] ? ».
        </p>
        <h4>Les couleurs</h4>
        <p>Le rayon se teinte selon les gemmes colorées qu'il touche en chemin :</p>
        <ul>
          <li>une seule couleur touchée → le rayon ressort de cette couleur ;</li>
          <li>une couleur + blanc → une version claire (rose, jaune clair, bleu clair) ;</li>
          <li>rouge + jaune → orange ; jaune + bleu → vert ; rouge + bleu → violet ;</li>
          <li>un de ces mélanges + blanc → sa version claire (orange clair, vert clair, violet clair) ;</li>
          <li>rouge + jaune + bleu (sans blanc) → noir ;</li>
          <li>les 4 couleurs → gris ;</li>
          <li>toucher deux fois la même couleur ne compte qu'une fois.</li>
        </ul>
        <p class="notice__hint">
          Toutes les combinaisons possibles, avec la silhouette exacte des gemmes touchées :
        </p>
        <ul class="notice__combo-gallery">${colorCombos}</ul>
      </section>

      <section class="notice__section">
        <h3>Mode Duel (à deux)</h3>
        <p>
          Chaque joueur place ses 5 gemmes en secret sur son propre plateau. Les rôles
          s'alternent à chaque tour : le <strong>prospecteur</strong> pose une question (rayon
          ou case précise) sur le plateau adverse, l'autre joueur y répond en <strong>maître du
          jeu</strong> en regardant son propre plateau.
        </p>
        <p>
          Le premier à proposer la disposition exacte des gemmes adverses gagne — mais une
          proposition erronée fait perdre immédiatement. Exception : si c'est le joueur qui a
          commencé la partie qui devine juste en premier, son adversaire a encore un tour pour
          proposer à son tour (victoire confirmée s'il se trompe, égalité s'il devine juste
          aussi).
        </p>
      </section>

      <section class="notice__section">
        <h3>Mode Fouille (2 joueurs ou plus)</h3>
        <p>
          Le plateau est généré aléatoirement par le site — personne ne le connaît à l'avance.
          Deux variantes possibles, au choix à la création du salon :
        </p>
        <ul>
          <li><strong>Parallèle</strong> : chacun interroge sa propre instance du plateau (la
            même disposition pour tous), à son rythme, sans voir les questions des autres.</li>
          <li><strong>Tour par tour</strong> : un plateau commun, questions et réponses visibles
            de tous, chacun son tour.</li>
        </ul>
        <p>
          Le premier à proposer la disposition exacte gagne. Une proposition erronée ne fait
          pas perdre tout de suite : il faut se tromper deux fois pour être éliminé. Si tout le
          monde est éliminé, personne ne gagne.
        </p>
      </section>
    </div>
  `;

  return () => {};
}

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

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

// Texte clair sur les teintes sombres/saturées (bleu, rouge, violet...),
// texte sombre sur les teintes claires — luminance relative approximée.
function contrastingTextColor(n: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#f5f5f0";
}

/** Toutes les combinaisons non vides des 4 couleurs (2^4 - 1 = 15),
 * regroupées par nombre de couleurs touchées — soit littéralement
 * « toutes les combinaisons » de mélange possibles au jeu. */
function colorComboGallery(): string {
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
  const resultHex = RAY_COLOR_HEX[resultName] ?? 0x999999;
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
      <span class="notice__combo-result" style="background:${hexColor(resultHex)};color:${contrastingTextColor(resultHex)}">${displayName}</span>
    </li>`;
}

function touchDiagram(cornerOnly: boolean): string {
  const secondTriangle = cornerOnly
    ? `<polygon points="96,0 192,0 192,96" fill="#d64545" fill-opacity="0.3" stroke="#d64545" stroke-width="3" />`
    : `<polygon points="96,0 192,0 192,96 96,96" fill="#d64545" fill-opacity="0.3" stroke="#d64545" stroke-width="3" />`;
  const firstShape = cornerOnly
    ? `<polygon points="0,96 96,96 96,0" fill="#3f7fd6" fill-opacity="0.3" stroke="#3f7fd6" stroke-width="3" />`
    : `<polygon points="0,0 96,0 96,96 0,96" fill="#3f7fd6" fill-opacity="0.3" stroke="#3f7fd6" stroke-width="3" />`;
  const marker = cornerOnly
    ? `<circle cx="96" cy="0" r="4" fill="#2ecc71" />`
    : `<line x1="96" y1="0" x2="96" y2="96" stroke="#e74c3c" stroke-width="4" />`;
  return `<svg viewBox="-6 -6 204 108" width="180" height="96">
    <g stroke="#ddd" stroke-width="1">
      <line x1="0" y1="0" x2="192" y2="0"/><line x1="0" y1="96" x2="192" y2="96"/>
      <line x1="0" y1="0" x2="0" y2="96"/><line x1="96" y1="0" x2="96" y2="96"/><line x1="192" y1="0" x2="192" y2="96"/>
    </g>
    ${firstShape}
    ${secondTriangle}
    ${marker}
  </svg>`;
}

function diagonalDiagram(): string {
  // Le rayon vient de la droite (case vide), heurte l'hypoténuse de la
  // gemme (case du milieu) sans jamais entrer dans sa silhouette, puis
  // dévie et ressort clairement à l'écart d'elle, en bas — pas à
  // travers un de ses côtés.
  return `<svg viewBox="-6 -6 300 168" width="220" height="124">
    <g stroke="#ddd" stroke-width="1">
      <line x1="0" y1="0" x2="288" y2="0"/><line x1="0" y1="96" x2="288" y2="96"/>
      <line x1="0" y1="0" x2="0" y2="96"/><line x1="96" y1="0" x2="96" y2="96"/>
      <line x1="192" y1="0" x2="192" y2="96"/><line x1="288" y1="0" x2="288" y2="96"/>
    </g>
    <polygon points="96,0 192,0 96,96" fill="#e0c23c" fill-opacity="0.35" stroke="#e0c23c" stroke-width="3" />
    <path d="M288,48 L144,48 L144,140" fill="none" stroke="#3f7fd6" stroke-width="4" marker-end="url(#arrow)" />
    <circle cx="144" cy="48" r="4" fill="#2ecc71" />
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#3f7fd6" />
      </marker>
    </defs>
  </svg>`;
}

function bounceDiagram(): string {
  return `<svg viewBox="-6 -6 204 108" width="180" height="96">
    <g stroke="#ddd" stroke-width="1">
      <line x1="0" y1="0" x2="192" y2="0"/><line x1="0" y1="96" x2="192" y2="96"/>
      <line x1="0" y1="0" x2="0" y2="96"/><line x1="96" y1="0" x2="96" y2="96"/><line x1="192" y1="0" x2="192" y2="96"/>
    </g>
    <rect x="96" y="0" width="96" height="96" fill="#d64545" fill-opacity="0.35" stroke="#d64545" stroke-width="3" />
    <path d="M0,44 L96,44" fill="none" stroke="#3f7fd6" stroke-width="4" />
    <path d="M96,52 L0,52" fill="none" stroke="#3f7fd6" stroke-width="4" marker-end="url(#arrow2)" />
    <defs>
      <marker id="arrow2" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#3f7fd6" />
      </marker>
    </defs>
  </svg>`;
}
