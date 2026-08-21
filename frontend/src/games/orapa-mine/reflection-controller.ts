/**
 * Panneau de pièces de réflexion : des repères personnels (pièce
 * complète, ou juste une case/demi-case colorée — voir
 * `types.ts:REFLECTION_UNIT_PALETTE`) que le joueur peut poser librement
 * pendant la phase de question, pour noter ses hypothèses avant de
 * proposer une solution. Interaction calquée sur
 * `placement-controller.ts` (palette, fantôme au survol, pivoter/
 * retourner, clic pour poser/retirer, raccourcis clavier R/F), mais :
 *
 * - jamais envoyé au serveur ni à l'adversaire — purement local, comme
 *   les croix (voir `board-scene.ts:toggleMark`) ;
 * - pas de règles de contact du livret : ces repères peuvent se
 *   chevaucher librement (ce ne sont pas de vraies gemmes), seule la
 *   limite du plateau est respectée (voir `PreviewBoard.placePieceUnchecked`) ;
 * - une entrée de palette reste posable autant de fois qu'on veut : pas
 *   de compteur "X/N" ni de bouton "valider" — juste "vider" pour tout
 *   effacer.
 */

import type { BoardScene } from "./board-scene";
import { pieceIconSvg } from "./piece-icon";
import { PlacementError, PreviewBoard } from "./preview-engine";
import { GemKind, type Color, type Piece, type PieceShape, type Position } from "./types";

export interface ReflectionPaletteEntry {
  shape: PieceShape;
  color?: Color;
  kind?: GemKind;
  label: string;
  /** "gem" (défaut) : une des 5 gemmes majeures (ou une extension) —
   * une hypothèse complète. "unit" : un simple repère élémentaire (case
   * ou demi-case colorée, voir `types.ts:REFLECTION_UNIT_PALETTE`) —
   * affiché séparément, plus petit (retour utilisateur direct : les
   * deux se distinguaient mal dans une seule grille). */
  variant?: "gem" | "unit";
}

export interface ReflectionControllerOptions {
  scene: BoardScene;
  paletteHost: HTMLElement;
  rotateButton: HTMLButtonElement;
  mirrorButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  statusHost?: HTMLElement;
  entries: ReadonlyArray<ReflectionPaletteEntry>;
}

export class ReflectionController {
  readonly board: PreviewBoard;
  private scene: BoardScene;
  private options: ReflectionControllerOptions;
  private armed: Piece | null = null;
  private hoveredCorner: Position | null = null;

  constructor(options: ReflectionControllerOptions) {
    this.options = options;
    this.scene = options.scene;
    this.board = new PreviewBoard(this.scene.dimensions);

    // Deux groupes distincts plutôt qu'une seule grille (retour
    // utilisateur direct) : les 5 gemmes majeures (+ extensions) d'un
    // côté, les petits repères élémentaires de l'autre — chacun dans sa
    // propre sous-grille, avec son propre intitulé si les deux sont
    // présents.
    const gemEntries = options.entries.filter((e) => (e.variant ?? "gem") === "gem");
    const unitEntries = options.entries.filter((e) => e.variant === "unit");
    const showLabels = gemEntries.length > 0 && unitEntries.length > 0;

    const gemHost = document.createElement("div");
    gemHost.className = "orapa-demo__palette orapa-mp__reflect-group orapa-mp__reflect-group--gems";
    const unitHost = document.createElement("div");
    unitHost.className = "orapa-demo__palette orapa-mp__reflect-group orapa-mp__reflect-group--units";

    // Pivoter/retourner rejoignent l'intitulé "Gemmes" (déplacés depuis
    // leur position d'origine dans le document, voir multiplayer.ts) au
    // lieu d'occuper toute une ligne à eux seuls en bas du panneau —
    // retour utilisateur direct, ce panneau prenait trop de hauteur.
    const gemHeadRow = document.createElement("div");
    gemHeadRow.className = "orapa-mp__reflect-group-head";
    if (showLabels) {
      const gemLabel = document.createElement("span");
      gemLabel.className = "om-eyebrow orapa-mp__reflect-group-label";
      gemLabel.textContent = "Gemmes";
      gemHeadRow.appendChild(gemLabel);
    }
    options.rotateButton.title = "Pivoter (touche R)";
    options.mirrorButton.title = "Retourner (touche F)";
    gemHeadRow.appendChild(options.rotateButton);
    gemHeadRow.appendChild(options.mirrorButton);
    options.paletteHost.appendChild(gemHeadRow);
    options.paletteHost.appendChild(gemHost);
    if (showLabels) {
      const unitLabel = document.createElement("span");
      unitLabel.className = "om-eyebrow orapa-mp__reflect-group-label";
      unitLabel.textContent = "Repères simples";
      options.paletteHost.appendChild(unitLabel);
    }
    options.paletteHost.appendChild(unitHost);

    for (const entry of options.entries) {
      const kind = entry.kind ?? GemKind.NORMAL;
      const isUnit = entry.variant === "unit";
      const button = document.createElement("button");
      button.type = "button";
      button.className = isUnit ? "orapa-demo__swatch orapa-demo__swatch--unit" : "orapa-demo__swatch";
      button.title = entry.label;
      button.innerHTML = pieceIconSvg(entry.shape, entry.color, isUnit ? 26 : 38, kind);
      button.addEventListener("click", () => {
        this.armed = {
          shape: entry.shape,
          kind,
          color: entry.color,
          origin: this.hoveredCorner ?? [0, 0],
          rotationSteps: 0,
          mirrored: false,
        };
        this.updateSwatchSelection(button);
        this.refreshGhost();
      });
      (isUnit ? unitHost : gemHost).appendChild(button);
    }

    options.rotateButton.addEventListener("click", () => this.rotateArmed());
    options.mirrorButton.addEventListener("click", () => this.mirrorArmed());
    options.clearButton.addEventListener("click", () => this.clearAll());
    document.addEventListener("keydown", this.handleKeyDown);

    this.activate();
  }

  /** (Ré)attache ce contrôleur aux callbacks de la scène — même besoin
   * que `PlacementController.activate`, voir sa docstring. */
  activate(): void {
    this.scene.onCornerHover = (corner) => {
      this.hoveredCorner = corner;
      this.refreshGhost();
      const existing = corner ? this.board.pieceAtCell(corner) : undefined;
      this.scene.setRemoveHighlight(existing ?? null);
    };
    this.scene.onCornerClick = ({ corner }) => this.handleCornerClick(corner);
    this.refreshGhost();
  }

  dispose(): void {
    this.scene.onCornerHover = null;
    this.scene.onCornerClick = null;
    this.scene.setRemoveHighlight(null);
    document.removeEventListener("keydown", this.handleKeyDown);
  }

  private rotateArmed(): void {
    if (!this.armed) return;
    this.armed = { ...this.armed, rotationSteps: (this.armed.rotationSteps + 1) % 4 };
    this.refreshGhost();
  }

  private mirrorArmed(): void {
    if (!this.armed) return;
    this.armed = { ...this.armed, mirrored: !this.armed.mirrored };
    this.refreshGhost();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "r" || event.key === "R") this.rotateArmed();
    else if (event.key === "f" || event.key === "F") this.mirrorArmed();
  };

  private handleCornerClick(corner: Position): void {
    // Cliquer une case déjà occupée par un repère le retire, qu'un
    // repère soit armé ou non — même logique que le placement réel.
    const existing = this.board.pieceAtCell(corner);
    if (existing) {
      this.board.removePiece(existing);
      this.scene.removeReflectionPiece(existing);
      this.setStatus("");
      return;
    }
    if (!this.armed) return;
    const positioned: Piece = { ...this.armed, origin: corner };
    try {
      this.board.placePieceUnchecked(positioned);
      this.scene.addReflectionPiece(positioned);
      this.setStatus("");
    } catch (error) {
      this.setStatus(error instanceof PlacementError ? error.message : String(error));
    }
  }

  private clearAll(): void {
    for (const piece of this.board.pieces()) this.board.removePiece(piece);
    this.scene.clearReflectionPieces();
    this.armed = null;
    this.updateSwatchSelection(null);
    this.refreshGhost();
    this.setStatus("");
  }

  private refreshGhost(): void {
    if (!this.armed) {
      this.scene.setGhost(null);
      return;
    }
    const positioned: Piece = { ...this.armed, origin: this.hoveredCorner ?? this.armed.origin };
    this.scene.setGhost(positioned, this.canPlace(positioned));
  }

  /** Seule règle pour un repère de réflexion : rester sur le plateau
   * (voir `PreviewBoard.placePieceUnchecked` — pas de contrôle de
   * chevauchement). Sert uniquement au fantôme (vert/rouge au survol). */
  private canPlace(piece: Piece): boolean {
    const quadrants = this.board.quadrants(piece);
    if (quadrants.size === 0) return false;
    for (const key of quadrants) {
      const [colStr, rowStr] = key.split(",");
      if (!this.board.contains([Number(colStr), Number(rowStr)])) return false;
    }
    return true;
  }

  private updateSwatchSelection(active: HTMLButtonElement | null): void {
    for (const button of this.options.paletteHost.querySelectorAll<HTMLButtonElement>(".orapa-demo__swatch")) {
      button.classList.toggle("is-selected", button === active);
    }
  }

  private setStatus(message: string): void {
    if (this.options.statusHost) this.options.statusHost.textContent = message;
  }
}
