/**
 * Démo hors-ligne du plateau 3D (Phase 3) : place tes propres pièces et
 * tire des rayons dessus, sur un seul plateau local. Ce n'est pas encore
 * le jeu multijoueur (Duel/Fouille, Phase 4) — voir `preview-engine.ts`
 * pour la mise en garde sur la logique de jeu utilisée ici.
 *
 * Le placement lui-même (aperçu, palette, rotation/miroir, pose,
 * retrait, placement aléatoire, validation) est géré par
 * `placement-controller.ts`, partagé avec l'écran de placement Duel en
 * multijoueur — voir ce module pour cette logique. "Tout retirer" (dans
 * le panneau, avant validation) vient de ce contrôleur ; "Vider le
 * plateau" (bouton séparé ci-dessous) reconstruit tout le contrôleur —
 * seul moyen de recommencer après avoir déjà validé un placement.
 */

import { BoardScene } from "./board-scene";
import { colorBadgeHtml } from "./color-swatch";
import { labelForExit } from "./entry-labels";
import { toContinuousCorner } from "./geometry";
import { PlacementController } from "./placement-controller";
import { type RayResult, fireRayPreview } from "./preview-engine";
import { DEFAULT_DIMENSIONS, EXTENSION_PIECE_PALETTE } from "./types";

export function mountOrapaMineDemo(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="orapa-demo">
      <div class="orapa-demo__canvas"></div>
      <aside class="orapa-demo__panel">
        <span class="om-eyebrow">Aperçu 3D hors ligne</span>
        <p class="orapa-demo__hint">
          Choisis une pièce, oriente-la (touches <kbd>R</kbd> pivoter / <kbd>F</kbd> retourner,
          en plus des boutons), puis clique une case pour la poser (reclique une pièce posée —
          elle se teinte en rouge au survol — pour la retirer). Chaque pièce ne peut être posée
          qu'une fois. Une fois les 5 gemmes de base posées, valide le placement, puis clique une
          borne du pourtour pour tirer un rayon. Le Diamant et le Corps noir (extensions) sont
          optionnels.
        </p>
        <div class="orapa-place__preview">
          <span class="om-eyebrow">Aperçu</span>
        </div>
        <div class="orapa-place__preview-box"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter 90°</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
        </div>
        <span class="om-eyebrow">Vos gemmes</span>
        <div class="orapa-demo__palette"></div>
        <div class="orapa-demo__bulk-actions">
          <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
          <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
        </div>
        <button type="button" class="orapa-demo__validate" disabled>Valider le placement (0/5)</button>
        <button type="button" class="orapa-demo__clear">Vider le plateau</button>
        <div class="orapa-demo__result" aria-live="polite"></div>
      </aside>
    </div>
  `;

  const canvasHost = root.querySelector<HTMLDivElement>(".orapa-demo__canvas");
  const paletteHost = root.querySelector<HTMLDivElement>(".orapa-demo__palette");
  const previewHost = root.querySelector<HTMLDivElement>(".orapa-place__preview-box");
  const resultHost = root.querySelector<HTMLDivElement>(".orapa-demo__result");
  const clearButton = root.querySelector<HTMLButtonElement>(".orapa-demo__clear");
  const bulkClearButton = root.querySelector<HTMLButtonElement>(".orapa-demo__bulk-clear");
  const bulkRandomButton = root.querySelector<HTMLButtonElement>(".orapa-demo__bulk-random");
  const rotateButton = root.querySelector<HTMLButtonElement>(".orapa-demo__rotate");
  const mirrorButton = root.querySelector<HTMLButtonElement>(".orapa-demo__mirror");
  const validateButton = root.querySelector<HTMLButtonElement>(".orapa-demo__validate");
  if (
    !canvasHost ||
    !paletteHost ||
    !previewHost ||
    !resultHost ||
    !clearButton ||
    !bulkClearButton ||
    !bulkRandomButton ||
    !rotateButton ||
    !mirrorButton ||
    !validateButton
  ) {
    throw new Error("Gabarit de la démo Orapa Mine incomplet.");
  }

  const scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
  const makePlacement = () =>
    new PlacementController({
      scene,
      paletteHost,
      previewHost,
      rotateButton,
      mirrorButton,
      validateButton,
      clearButton: bulkClearButton,
      randomButton: bulkRandomButton,
      statusHost: resultHost,
      extensionPieces: EXTENSION_PIECE_PALETTE,
      onValidate: () => {
        resultHost.textContent = "Placement validé — clique une borne du pourtour pour tirer un rayon.";
      },
    });
  let placement: PlacementController | null = makePlacement();

  scene.onEntryClick = ({ label, entry }) => {
    if (!placement) return;
    let result: RayResult;
    try {
      result = fireRayPreview(placement.board, entry.position, entry.direction);
    } catch (error) {
      resultHost.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    // `entry.position` est une position DISCRÈTE (voir borders.ts) ;
    // `result.path` est déjà en coordonnées continues (preview-engine.ts)
    // — il ne faut surtout pas les mélanger sans convertir l'entrée.
    scene.animateRay(toContinuousCorner(entry.position), result.path, result.colorName);
    resultHost.innerHTML = describeResult(label, result);
  };

  clearButton.addEventListener("click", () => {
    placement?.dispose();
    paletteHost.innerHTML = "";
    paletteHost.classList.remove("orapa-demo__palette--list");
    scene.setPieces([]);
    scene.setGhost(null);
    scene.clearRay();
    resultHost.textContent = "";
    placement = makePlacement();
  });

  return () => {
    placement?.dispose();
    scene.dispose();
  };
}

function describeResult(entryLabel: string, result: RayResult): string {
  if (result.absorbed) {
    return `<strong>Rayon depuis ${entryLabel}</strong> : signal absorbé.`;
  }
  const exitLabel = labelForExit(result.exit!, result.exitDirection!);
  return `<strong>Rayon depuis ${entryLabel}</strong> : sort en ${exitLabel} — couleur ${colorBadgeHtml(result.colorName)}.`;
}
