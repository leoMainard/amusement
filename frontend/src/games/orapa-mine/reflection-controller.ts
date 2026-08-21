/**
 * Panneau de pièces de réflexion : des repères personnels (pièce
 * complète, ou juste une case/demi-case colorée — voir
 * `types.ts:REFLECTION_UNIT_PALETTE`) que le joueur peut poser librement
 * pendant la phase de question, pour noter ses hypothèses avant de
 * proposer une solution. Même présentation que `placement-controller.ts`
 * (aperçu, pivoter/retourner, liste "Vos gemmes", vider — retour
 * utilisateur direct : les deux doivent se ressembler), mais :
 *
 * - jamais envoyé au serveur ni à l'adversaire — purement local, comme
 *   les croix (voir `board-scene.ts:toggleMark`) ;
 * - pas de règles de contact du livret : ces repères peuvent se
 *   chevaucher librement (ce ne sont pas de vraies gemmes), seule la
 *   limite du plateau est respectée (voir `PreviewBoard.placePieceUnchecked`) ;
 * - une entrée de palette reste posable autant de fois qu'on veut : pas
 *   de compteur "X/N" ni de bouton "valider" — juste "vider" pour tout
 *   effacer, jamais désactivée après une pose.
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
  /** Cadre "APERÇU" (voir `placement-controller.ts`) : optionnel,
   * absent si non fourni. */
  previewHost?: HTMLElement;
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
    // utilisateur direct) : les 5 gemmes majeures (+ extensions), en
    // liste façon "VOS GEMMES" (même style que `placement-controller.ts`),
    // et les petits repères élémentaires à part, en grille compacte.
    const gemEntries = options.entries.filter((e) => (e.variant ?? "gem") === "gem");
    const unitEntries = options.entries.filter((e) => e.variant === "unit");

    const gemHost = document.createElement("div");
    gemHost.className = "orapa-demo__palette orapa-demo__palette--list";
    const unitHost = document.createElement("div");
    unitHost.className = "orapa-demo__palette orapa-mp__reflect-group--units";

    // Même cadre "bloc sombre" que "Vos gemmes"/"Aperçu" partout ailleurs
    // (voir placement-controller.ts / demo.ts / multiplayer.ts) — retour
    // utilisateur direct, pour que ce panneau se distingue clairement du
    // fond de page comme les autres.
    if (gemEntries.length > 0) {
      const gemGroup = document.createElement("div");
      gemGroup.className = "orapa-demo__group orapa-demo__group--gems";
      const gemLabel = document.createElement("span");
      gemLabel.className = "om-eyebrow";
      gemLabel.textContent = "Vos gemmes";
      gemGroup.append(gemLabel, gemHost);
      options.paletteHost.appendChild(gemGroup);
    }
    if (unitEntries.length > 0) {
      const unitGroup = document.createElement("div");
      unitGroup.className = "orapa-demo__group orapa-demo__group--units";
      const unitLabel = document.createElement("span");
      unitLabel.className = "om-eyebrow";
      unitLabel.textContent = "Repères simples";
      unitGroup.append(unitLabel, unitHost);
      options.paletteHost.appendChild(unitGroup);
    }

    for (const entry of options.entries) {
      const kind = entry.kind ?? GemKind.NORMAL;
      const isUnit = entry.variant === "unit";
      const button = document.createElement("button");
      button.type = "button";
      button.title = entry.label;
      if (isUnit) {
        button.className = "orapa-demo__swatch orapa-demo__swatch--unit";
        button.innerHTML = pieceIconSvg(entry.shape, entry.color, 26, kind);
      } else {
        // Liste "VOS GEMMES" : icône + libellé, comme placement-controller.ts
        // (pas de statut "posée" ici — un repère reste posable autant de
        // fois qu'on veut, "posée" n'aurait pas de sens).
        button.className = "orapa-demo__swatch";
        button.innerHTML = `
          <span class="orapa-demo__swatch-icon">${pieceIconSvg(entry.shape, entry.color, 32, kind)}</span>
          <span class="orapa-demo__swatch-label">${entry.label}</span>
        `;
      }
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
        this.refreshPreview();
      });
      (isUnit ? unitHost : gemHost).appendChild(button);
    }

    options.rotateButton.addEventListener("click", () => this.rotateArmed());
    options.mirrorButton.addEventListener("click", () => this.mirrorArmed());
    options.clearButton.addEventListener("click", () => this.clearAll());

    this.activate();
    this.refreshPreview();
  }

  /** (Ré)attache le survol (fantôme + surbrillance de retrait) et le
   * raccourci clavier R/F. Depuis que "Placer des repères" reste affiché
   * en permanence (retour utilisateur direct — plus de bouton pour
   * l'activer), c'est `multiplayer.ts` qui possède seul
   * `scene.onCornerClick` et arbitre entre marquer une case, placer un
   * repère (voir `handleClick`) ou sélectionner une cible de question ;
   * cette classe ne le pose donc plus elle-même ici. Réattacher R/F à
   * chaque `activate()` reste nécessaire : `dispose()` retire l'écouteur
   * et rien d'autre ne le reposerait sinon (même bug déjà corrigé dans
   * `placement-controller.ts`, voir sa docstring). */
  activate(): void {
    this.scene.onCornerHover = (corner) => {
      this.hoveredCorner = corner;
      this.refreshGhost();
      const existing = corner ? this.board.pieceAtCell(corner) : undefined;
      this.scene.setRemoveHighlight(existing ?? null);
    };
    document.addEventListener("keydown", this.handleKeyDown);
    this.refreshGhost();
  }

  /** Traite un clic sur `corner` pour le compte de l'appelant (voir
   * docstring d'`activate`). Retourne `true` si une pièce armée a été
   * posée (ou une pièce déjà posée retirée) — le clic est alors
   * "consommé", l'appelant n'a rien d'autre à faire. Retourne `false`
   * si rien n'était armé sur une case vide : l'appelant reste libre
   * d'interpréter ce clic autrement (ex. sélectionner une cible pour
   * "Interroger une case"). */
  handleClick(corner: Position): boolean {
    return this.handleCornerClick(corner);
  }

  dispose(): void {
    this.scene.onCornerHover = null;
    this.scene.setRemoveHighlight(null);
    document.removeEventListener("keydown", this.handleKeyDown);
  }

  private rotateArmed(): void {
    if (!this.armed) return;
    this.armed = { ...this.armed, rotationSteps: (this.armed.rotationSteps + 1) % 4 };
    this.refreshGhost();
    this.refreshPreview();
  }

  private mirrorArmed(): void {
    if (!this.armed) return;
    this.armed = { ...this.armed, mirrored: !this.armed.mirrored };
    this.refreshGhost();
    this.refreshPreview();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "r" || event.key === "R") this.rotateArmed();
    else if (event.key === "f" || event.key === "F") this.mirrorArmed();
  };

  private handleCornerClick(corner: Position): boolean {
    // Cliquer une case déjà occupée par un repère le retire, qu'un
    // repère soit armé ou non — même logique que le placement réel.
    const existing = this.board.pieceAtCell(corner);
    if (existing) {
      this.board.removePiece(existing);
      this.scene.removeReflectionPiece(existing);
      this.setStatus("");
      return true;
    }
    if (!this.armed) return false;
    const positioned: Piece = { ...this.armed, origin: corner };
    try {
      this.board.placePieceUnchecked(positioned);
      this.scene.addReflectionPiece(positioned);
      this.setStatus("");
    } catch (error) {
      this.setStatus(error instanceof PlacementError ? error.message : String(error));
    }
    // Une pièce était armée : le clic visait bien à poser un repère ici,
    // même si la pose a échoué (message déjà affiché) — pas question de
    // retomber sur la sélection d'une cible de question à la place.
    return true;
  }

  private clearAll(): void {
    for (const piece of this.board.pieces()) this.board.removePiece(piece);
    this.scene.clearReflectionPieces();
    this.armed = null;
    this.updateSwatchSelection(null);
    this.refreshGhost();
    this.refreshPreview();
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

  /** Cadre "APERÇU" (voir docstring de `previewHost`). */
  private refreshPreview(): void {
    const host = this.options.previewHost;
    if (!host) return;
    if (!this.armed) {
      host.innerHTML = `<span class="orapa-place__preview-empty">Aucune gemme sélectionnée</span>`;
      return;
    }
    const icon = pieceIconSvg(this.armed.shape, this.armed.color, 76, this.armed.kind, this.armed.rotationSteps, this.armed.mirrored);
    const angle = (this.armed.rotationSteps * 90) % 360;
    const mirrorBadge = this.armed.mirrored ? `<span class="orapa-place__preview-angle orapa-place__preview-angle--mirror">⇋</span>` : "";
    host.innerHTML = `<span class="orapa-place__preview-angle">${angle}°</span>${mirrorBadge}${icon}`;
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
