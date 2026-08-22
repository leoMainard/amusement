/**
 * Notice d'Orapa Mine — règles reformulées avec nos propres mots et nos
 * propres schémas (voir docs/plan.md : rien n'est copié depuis le
 * livret officiel, qui reste une référence de travail non versionnée
 * dans `regles/`).
 */

import { BASE_PIECE_PALETTE, EXTENSION_PIECE_PALETTE } from "../../games/orapa-mine/types";
import { pieceIconSvg } from "../../games/orapa-mine/piece-icon";
import { colorComboGalleryHtml } from "../../games/orapa-mine/color-combos";

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

  const colorCombos = colorComboGalleryHtml();

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
          Le premier à proposer la disposition exacte des gemmes adverses gagne. Une
          proposition erronée ne fait pas perdre tout de suite : il faut se tromper deux fois
          pour être éliminé — l'adversaire garde alors la main pour continuer à chercher seul.
          Si les deux se trompent deux fois, la partie se termine sur une égalité.
        </p>
      </section>

      <section class="notice__section">
        <h3>Mode Fouille (seul, ou à plusieurs)</h3>
        <p>
          Le plateau est généré aléatoirement par le site — personne ne le connaît à l'avance.
          Un plateau commun, questions et réponses visibles de tous, chacun son tour — jouable
          seul (dans ce cas, c'est toujours ton tour) comme à plusieurs.
        </p>
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

// Couleurs des schémas alignées sur la palette de la maquette (voir
// `types.ts:GEM_DISPLAY_COLOR`) : lignes de grille en crème translucide
// (au lieu de gris clair, invisible sur le fond bleu nuit).
const DIAGRAM_GRID = "rgba(244, 234, 214, 0.3)";
const DIAGRAM_RED = "#e83c30";
const DIAGRAM_BLUE = "#2f7ff0";
const DIAGRAM_GOLD = "#f2c24b";

function touchDiagram(cornerOnly: boolean): string {
  const secondTriangle = cornerOnly
    ? `<polygon points="96,0 192,0 192,96" fill="${DIAGRAM_RED}" fill-opacity="0.35" stroke="${DIAGRAM_RED}" stroke-width="3" />`
    : `<polygon points="96,0 192,0 192,96 96,96" fill="${DIAGRAM_RED}" fill-opacity="0.35" stroke="${DIAGRAM_RED}" stroke-width="3" />`;
  const firstShape = cornerOnly
    ? `<polygon points="0,96 96,96 96,0" fill="${DIAGRAM_BLUE}" fill-opacity="0.35" stroke="${DIAGRAM_BLUE}" stroke-width="3" />`
    : `<polygon points="0,0 96,0 96,96 0,96" fill="${DIAGRAM_BLUE}" fill-opacity="0.35" stroke="${DIAGRAM_BLUE}" stroke-width="3" />`;
  const marker = cornerOnly
    ? `<circle cx="96" cy="0" r="4" fill="${DIAGRAM_GOLD}" />`
    : `<line x1="96" y1="0" x2="96" y2="96" stroke="#ff8a80" stroke-width="4" />`;
  return `<svg viewBox="-6 -6 204 108" width="180" height="96">
    <g stroke="${DIAGRAM_GRID}" stroke-width="1">
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
    <g stroke="${DIAGRAM_GRID}" stroke-width="1">
      <line x1="0" y1="0" x2="288" y2="0"/><line x1="0" y1="96" x2="288" y2="96"/>
      <line x1="0" y1="0" x2="0" y2="96"/><line x1="96" y1="0" x2="96" y2="96"/>
      <line x1="192" y1="0" x2="192" y2="96"/><line x1="288" y1="0" x2="288" y2="96"/>
    </g>
    <polygon points="96,0 192,0 96,96" fill="${DIAGRAM_GOLD}" fill-opacity="0.4" stroke="${DIAGRAM_GOLD}" stroke-width="3" />
    <path d="M288,48 L144,48 L144,140" fill="none" stroke="${DIAGRAM_BLUE}" stroke-width="4" marker-end="url(#arrow)" />
    <circle cx="144" cy="48" r="4" fill="#f4ead6" />
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="${DIAGRAM_BLUE}" />
      </marker>
    </defs>
  </svg>`;
}

function bounceDiagram(): string {
  return `<svg viewBox="-6 -6 204 108" width="180" height="96">
    <g stroke="${DIAGRAM_GRID}" stroke-width="1">
      <line x1="0" y1="0" x2="192" y2="0"/><line x1="0" y1="96" x2="192" y2="96"/>
      <line x1="0" y1="0" x2="0" y2="96"/><line x1="96" y1="0" x2="96" y2="96"/><line x1="192" y1="0" x2="192" y2="96"/>
    </g>
    <rect x="96" y="0" width="96" height="96" fill="${DIAGRAM_RED}" fill-opacity="0.4" stroke="${DIAGRAM_RED}" stroke-width="3" />
    <path d="M0,44 L96,44" fill="none" stroke="${DIAGRAM_BLUE}" stroke-width="4" />
    <path d="M96,52 L0,52" fill="none" stroke="${DIAGRAM_BLUE}" stroke-width="4" marker-end="url(#arrow2)" />
    <defs>
      <marker id="arrow2" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="${DIAGRAM_BLUE}" />
      </marker>
    </defs>
  </svg>`;
}
