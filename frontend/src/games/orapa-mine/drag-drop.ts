/**
 * Glisser-déposer d'une gemme depuis sa vignette de palette jusqu'au
 * plateau (retour utilisateur direct — "je souhaite pouvoir glisser /
 * déposer les pièces, en plus de... cliquer / déposer"). Point d'entrée
 * unique, réutilisé par `placement-controller.ts` ET
 * `reflection-controller.ts` : ni l'un ni l'autre ne réimplémente le
 * suivi du pointeur.
 *
 * Volontairement SANS l'API HTML5 Drag and Drop (`draggable="true"`) —
 * elle ne marche pas au toucher, alors que le reste du plateau reste
 * jouable au clic/toucher partout ailleurs (`BoardScene` n'utilise que
 * des événements de pointeur génériques). Suivi manuel à la place, via
 * `pointerdown`/`pointermove`/`pointerup` sur `window` : au-dessus du
 * plateau, un `pointermove` de SYNTHÈSE est envoyé au `<canvas>` pour
 * réutiliser tel quel le survol/fantôme déjà en place côté
 * `BoardScene`, sans dupliquer son raycasting ici — au relâchement, la
 * case visée est résolue via `BoardScene.getCornerAt` plutôt qu'en
 * synthétisant un "click" (qui réutiliserait à tort le comportement
 * "case déjà occupée -> retirer la pièce qui s'y trouve" prévu pour un
 * simple clic, pas pour un dépôt — voir `dropArmedAt` dans les deux
 * contrôleurs).
 *
 * Un simple clic (relâché sans dépasser `DRAG_THRESHOLD_PX`) ne
 * déclenche rien ici : le gestionnaire `click` déjà posé sur le bouton
 * (armer/désarmer, voir les deux contrôleurs) s'en charge normalement,
 * intact.
 */

import type { Position } from "./types";

export interface SwatchDragHandlers {
  /** Le pointeur vient de dépasser le seuil de déplacement — doit armer
   * la pièce (même effet qu'un clic sur sa vignette). */
  onDragStart: () => void;
  /** Pointeur relâché AU-DESSUS d'une case valide du plateau. */
  onDrop: (corner: Position) => void;
  /** Relâché hors du plateau (ou glisser interrompu, ex. changement
   * d'onglet) : désarme, comme un Échap. */
  onCancel: () => void;
}

export interface SwatchDragOptions {
  getCanvas: () => HTMLElement;
  getCornerAt: (clientX: number, clientY: number) => Position | null;
  /** Petit aperçu SVG de la pièce (voir `pieceIconSvg`) qui suit le
   * curseur tant qu'il n'est pas au-dessus du plateau (le vrai fantôme
   * 3D prend le relais une fois dessus, pas la peine des deux à la
   * fois). */
  iconHtml: string;
}

const DRAG_THRESHOLD_PX = 4;

export function makeSwatchDraggable(button: HTMLButtonElement, options: SwatchDragOptions, handlers: SwatchDragHandlers): void {
  button.addEventListener("pointerdown", (event: PointerEvent) => {
    if (button.disabled || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let overCanvas = false;
    let preview: HTMLDivElement | null = null;

    const showPreview = (x: number, y: number) => {
      if (!preview) {
        preview = document.createElement("div");
        preview.className = "orapa-drag-preview";
        preview.innerHTML = options.iconHtml;
        document.body.appendChild(preview);
      }
      preview.style.left = `${x}px`;
      preview.style.top = `${y}px`;
    };

    const hidePreview = () => {
      preview?.remove();
      preview = null;
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("orapa-dragging");
      hidePreview();
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        document.body.classList.add("orapa-dragging");
        handlers.onDragStart();
      }
      const rect = options.getCanvas().getBoundingClientRect();
      overCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (overCanvas) {
        hidePreview();
        // Fait vivre le fantôme de survol déjà géré par `BoardScene`
        // (voir docstring du module) — cet événement ne déclenche
        // jamais de pose : seul `onCornerHover` y réagit. SANS bulle
        // (`bubbles: false`, contrairement au reste du module) : le
        // `<canvas>` a son propre écouteur direct dessus (pas besoin de
        // remonter jusqu'à `window`), et laisser buller reviendrait à le
        // recapturer nous-mêmes juste en dessous — boucle infinie
        // (`Maximum call stack size exceeded`, repéré via QA).
        options.getCanvas().dispatchEvent(new PointerEvent("pointermove", { clientX: e.clientX, clientY: e.clientY, bubbles: false }));
      } else {
        showPreview(e.clientX, e.clientY);
      }
    };

    const onUp = (e: PointerEvent) => {
      cleanup();
      if (!dragging) return; // simple clic : laisse le gestionnaire `click` du bouton s'en occuper
      const corner = overCanvas ? options.getCornerAt(e.clientX, e.clientY) : null;
      if (corner) handlers.onDrop(corner);
      else handlers.onCancel();
    };

    const onCancel = () => {
      cleanup();
      if (dragging) handlers.onCancel();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}
