/**
 * Démo hors-ligne du plateau 3D (Phase 3) : place tes propres pièces et
 * tire des rayons dessus, sur un seul plateau local. Ce n'est pas encore
 * le jeu multijoueur (Duel/Fouille, Phase 4) — voir `preview-engine.ts`
 * pour la mise en garde sur la logique de jeu utilisée ici.
 *
 * Chaque pièce de la variante de base ne peut être posée qu'une seule
 * fois (comme dans le vrai jeu, où chaque joueur dispose d'un exemplaire
 * de chaque gemme) ; le placement doit être validé — les 5 pièces
 * posées — avant de pouvoir considérer le plateau comme prêt.
 */

import { BoardScene } from "./board-scene";
import { placeShape } from "./piece-shapes";
import { type RayResult, fireRayPreview, PlacementError, PreviewBoard } from "./preview-engine";
import { BASE_PIECE_PALETTE, DEFAULT_DIMENSIONS, GemKind, type Piece, type PieceShape, type Position } from "./types";

function paletteKey(shape: PieceShape, color: string): string {
  return `${shape}:${color}`;
}

export function mountOrapaMineDemo(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="orapa-demo">
      <div class="orapa-demo__canvas"></div>
      <aside class="orapa-demo__panel">
        <h3>Aperçu 3D hors ligne</h3>
        <p class="orapa-demo__hint">
          Choisis une pièce, oriente-la, puis clique une case pour la poser (reclique une pièce
          posée pour la retirer). Chaque pièce ne peut être posée qu'une fois. Une fois les 5
          posées, valide le placement, puis clique une borne du pourtour pour tirer un rayon.
        </p>
        <div class="orapa-demo__palette"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
        </div>
        <button type="button" class="orapa-demo__validate" disabled>Valider le placement (0/5)</button>
        <button type="button" class="orapa-demo__clear">Vider le plateau</button>
        <div class="orapa-demo__result" aria-live="polite"></div>
      </aside>
    </div>
  `;

  const canvasHost = root.querySelector<HTMLDivElement>(".orapa-demo__canvas");
  const paletteHost = root.querySelector<HTMLDivElement>(".orapa-demo__palette");
  const resultHost = root.querySelector<HTMLDivElement>(".orapa-demo__result");
  const clearButton = root.querySelector<HTMLButtonElement>(".orapa-demo__clear");
  const rotateButton = root.querySelector<HTMLButtonElement>(".orapa-demo__rotate");
  const mirrorButton = root.querySelector<HTMLButtonElement>(".orapa-demo__mirror");
  const validateButton = root.querySelector<HTMLButtonElement>(".orapa-demo__validate");
  if (!canvasHost || !paletteHost || !resultHost || !clearButton || !rotateButton || !mirrorButton || !validateButton) {
    throw new Error("Gabarit de la démo Orapa Mine incomplet.");
  }

  // La pièce "armée" : celle qu'on s'apprête à poser, avec sa
  // rotation/miroir en cours d'ajustement. `null` = rien de sélectionné.
  let armed: Piece | null = null;
  let hoveredCorner: Position | null = null;
  const usedKeys = new Set<string>(); // pièces déjà posées, une seule fois chacune
  let validated = false;

  const swatchByKey = new Map<string, HTMLButtonElement>();
  for (const { shape, color, label } of BASE_PIECE_PALETTE) {
    const key = paletteKey(shape, color);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orapa-demo__swatch";
    button.title = label;
    button.innerHTML = paletteIcon(shape, color);
    button.addEventListener("click", () => {
      if (button.disabled) return;
      armed = {
        shape,
        kind: GemKind.NORMAL,
        color,
        origin: hoveredCorner ?? [0, 0],
        rotationSteps: 0,
        mirrored: false,
      };
      updateSwatchSelection(button);
      refreshGhost();
    });
    paletteHost.appendChild(button);
    swatchByKey.set(key, button);
  }

  function updateSwatchSelection(active: HTMLButtonElement | null): void {
    for (const button of paletteHost!.querySelectorAll<HTMLButtonElement>(".orapa-demo__swatch")) {
      button.classList.toggle("is-selected", button === active);
    }
  }

  function updatePaletteAvailability(): void {
    for (const [key, button] of swatchByKey) {
      button.disabled = validated || usedKeys.has(key);
    }
    validateButton!.textContent = `Valider le placement (${usedKeys.size}/${BASE_PIECE_PALETTE.length})`;
    validateButton!.disabled = validated || usedKeys.size < BASE_PIECE_PALETTE.length;
    rotateButton!.disabled = validated;
    mirrorButton!.disabled = validated;
  }
  updatePaletteAvailability();

  rotateButton.addEventListener("click", () => {
    if (!armed) return;
    armed = { ...armed, rotationSteps: (armed.rotationSteps + 1) % 4 };
    refreshGhost();
  });
  mirrorButton.addEventListener("click", () => {
    if (!armed) return;
    armed = { ...armed, mirrored: !armed.mirrored };
    refreshGhost();
  });

  const board = new PreviewBoard(DEFAULT_DIMENSIONS);
  const scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);

  function refreshPieces(): void {
    scene.setPieces(board.pieces());
  }

  function refreshGhost(): void {
    if (!armed || validated) {
      scene.setGhost(null);
      return;
    }
    const positioned: Piece = { ...armed, origin: hoveredCorner ?? armed.origin };
    scene.setGhost(positioned, board.canPlace(positioned));
  }

  scene.onCornerHover = (corner) => {
    hoveredCorner = corner;
    refreshGhost();
  };

  scene.onCornerClick = ({ corner }) => {
    if (!armed || validated) return;
    const positioned: Piece = { ...armed, origin: corner };
    try {
      board.placePiece(positioned);
      usedKeys.add(paletteKey(positioned.shape, positioned.color!));
      armed = null;
      updateSwatchSelection(null);
      refreshPieces();
      refreshGhost();
      updatePaletteAvailability();
      resultHost.textContent = "";
    } catch (error) {
      resultHost.textContent = error instanceof PlacementError ? error.message : String(error);
    }
  };

  scene.onPieceClick = ({ piece }) => {
    if (validated) return;
    board.removePiece(piece);
    usedKeys.delete(paletteKey(piece.shape, piece.color!));
    refreshPieces();
    updatePaletteAvailability();
    resultHost.textContent = "";
  };

  scene.onEntryClick = ({ label, entry }) => {
    let result: RayResult;
    try {
      result = fireRayPreview(board, entry.position, entry.direction);
    } catch (error) {
      resultHost.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    scene.animateRay(entry.position, result.path, result.colorName);
    resultHost.innerHTML = describeResult(label, result);
  };

  validateButton.addEventListener("click", () => {
    if (usedKeys.size < BASE_PIECE_PALETTE.length) return;
    validated = true;
    armed = null;
    updateSwatchSelection(null);
    refreshGhost();
    updatePaletteAvailability();
    resultHost.textContent = "";
  });

  clearButton.addEventListener("click", () => {
    for (const piece of board.pieces()) board.removePiece(piece);
    usedKeys.clear();
    validated = false;
    armed = null;
    updateSwatchSelection(null);
    refreshPieces();
    refreshGhost();
    updatePaletteAvailability();
    scene.clearRay();
    resultHost.textContent = "";
  });

  return () => scene.dispose();
}

function describeResult(entryLabel: string, result: RayResult): string {
  if (result.absorbed) {
    return `<strong>Rayon depuis ${entryLabel}</strong> : signal absorbé.`;
  }
  const [col, row] = result.exit!;
  return `<strong>Rayon depuis ${entryLabel}</strong> : sort en (${col}, ${row}) — couleur <em>${result.colorName}</em>.`;
}

/** Icône SVG miniature d'une pièce, pour la palette — utilise sa vraie
 * silhouette (voir `piece-shapes.ts`), pas juste une pastille de couleur. */
function paletteIcon(shape: PieceShape, color: string): string {
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
  const fill = { RED: "#d64545", YELLOW: "#e0c23c", BLUE: "#3f7fd6", WHITE: "#ffffff" }[color] ?? "#999";
  return `<svg viewBox="0 0 ${viewW} ${viewH}" width="44" height="44" role="img" aria-hidden="true">
    <polygon points="${points}" fill="${fill}" stroke="#3b3a35" stroke-width="0.06" />
  </svg>`;
}
