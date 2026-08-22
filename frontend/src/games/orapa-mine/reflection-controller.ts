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
 * - les repères élémentaires ("unit") peuvent se chevaucher librement
 *   (ce ne sont pas de vraies gemmes) : seule la limite du plateau est
 *   respectée (voir `PreviewBoard.placePieceUnchecked`), et une entrée
 *   reste posable autant de fois qu'on veut ;
 * - les 5 gemmes majeures/extensions ("gem") sont de vraies hypothèses
 *   de placement : elles suivent les mêmes règles de contact que le
 *   livret (`PreviewBoard.placePiece` — retour utilisateur direct, un
 *   vrai bug permettait de les empiler les unes sur les autres) et
 *   chacune ne peut être positionnée qu'à un seul endroit à la fois — le
 *   bouton correspondant se désactive tant qu'elle est posée, comme
 *   `placement-controller.ts` (mais reste librement déplaçable : la
 *   retirer du plateau réarme sa case dans la palette).
 */

import type { BoardScene } from "./board-scene";
import { makeSwatchDraggable } from "./drag-drop";
import { pieceIconSvg } from "./piece-icon";
import { PlacementError, PreviewBoard } from "./preview-engine";
import { GemKind, type Color, type Piece, type PieceShape, type Position } from "./types";

function pieceKey(p: { shape: PieceShape; kind: GemKind; color?: Color }): string {
  return `${p.shape}:${p.kind}:${p.color ?? ""}`;
}

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
  /** Bouton "Marquer des cases" (voir `multiplayer.ts`) : traité comme
   * un repère élémentaire de plus (retour utilisateur direct — "je le
   * verrai plus comme une simple croix à côté des autres repères
   * simples"), au lieu d'un bouton à part. Câblé par l'appelant
   * (l'activation du mode marquage reste arbitrée par `multiplayer.ts`,
   * pas par ce contrôleur) ; ce module se contente de le restyler en
   * case de la grille "Repères simples" et de l'y placer en premier.
   * Ignoré si absent, ou si aucun repère élémentaire n'est fourni (rien
   * à regrouper avec). */
  markToggleButton?: HTMLButtonElement;
  /** Appelé quand une gemme/un repère devient armé (voir le gestionnaire
   * de clic des boutons de palette, plus bas) — permet à l'appelant de
   * désactiver le mode marquage en cours (retour utilisateur direct : un
   * vrai bug permettait d'avoir à la fois une croix ET une gemme/un
   * repère sélectionnés). Rien d'équivalent n'est nécessaire dans l'autre
   * sens : voir `disarm()`, public, que `multiplayer.ts` appelle en
   * activant le mode marquage. */
  onArm?: () => void;
}

export class ReflectionController {
  readonly board: PreviewBoard;
  private scene: BoardScene;
  private options: ReflectionControllerOptions;
  private armed: Piece | null = null;
  /** La pièce actuellement armée est-elle une des 5 gemmes majeures (ou
   * une extension), plutôt qu'un repère élémentaire ? Détermine quelles
   * règles de placement s'appliquent (voir `handleCornerClick`/`canPlace`) —
   * un `Piece` seul ne porte pas cette distinction. */
  private armedIsGem = false;
  private hoveredCorner: Position | null = null;
  /** Gemmes majeures/extensions actuellement posées (voir docstring du
   * module) : une seule à la fois par gemme — son bouton de palette se
   * désactive tant qu'elle y figure. Les repères élémentaires n'y
   * figurent jamais (toujours reposables librement). */
  private usedGemKeys = new Set<string>();
  private gemSwatchByKey = new Map<string, HTMLButtonElement>();

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
      if (options.markToggleButton) {
        // Même case que les autres repères élémentaires (icône, taille),
        // juste une croix plutôt qu'une pièce — posée en premier dans la
        // grille. `.orapa-mp__mark-toggle` (pas `.orapa-demo__swatch`
        // seul) permet à `updateSwatchSelection` de l'exclure de son
        // survol des gemmes/repères armés (voir plus bas) : son
        // "is-selected" à elle est géré indépendamment par
        // `multiplayer.ts` (mode marquage, pas une pièce armée).
        const btn = options.markToggleButton;
        btn.className = "orapa-demo__swatch orapa-demo__swatch--unit orapa-mp__mark-toggle";
        btn.title = "Marquer des cases";
        btn.textContent = "✕";
        unitHost.appendChild(btn);
      }
    }

    for (const entry of options.entries) {
      const kind = entry.kind ?? GemKind.NORMAL;
      const isUnit = entry.variant === "unit";
      const gemKey = isUnit ? null : pieceKey({ shape: entry.shape, kind, color: entry.color });
      const button = document.createElement("button");
      button.type = "button";
      button.title = entry.label;
      if (isUnit) {
        button.className = "orapa-demo__swatch orapa-demo__swatch--unit";
        button.innerHTML = pieceIconSvg(entry.shape, entry.color, 26, kind);
      } else {
        // Liste "VOS GEMMES" : icône + libellé, comme placement-controller.ts.
        button.className = "orapa-demo__swatch";
        button.innerHTML = `
          <span class="orapa-demo__swatch-icon">${pieceIconSvg(entry.shape, entry.color, 32, kind)}</span>
          <span class="orapa-demo__swatch-label">${entry.label}</span>
        `;
        if (gemKey) this.gemSwatchByKey.set(gemKey, button);
      }
      button.addEventListener("click", () => {
        if (button.disabled) return;
        // Recliquer la gemme/le repère déjà armé la désélectionne plutôt
        // que de la réarmer inutilement (retour utilisateur direct :
        // aucun moyen de "relâcher" une pièce sans en armer une autre).
        if (button.classList.contains("is-selected")) {
          this.disarm();
          return;
        }
        this.armEntry(entry, kind, isUnit, button);
      });
      // Glisser-déposer (retour utilisateur direct), EN PLUS du clic
      // ci-dessus — voir `drag-drop.ts`.
      makeSwatchDraggable(
        button,
        {
          getCanvas: () => this.scene.canvasElement,
          getCornerAt: (x, y) => this.scene.getCornerAt(x, y),
          iconHtml: pieceIconSvg(entry.shape, entry.color, isUnit ? 26 : 40, kind),
        },
        {
          onDragStart: () => this.armEntry(entry, kind, isUnit, button),
          onDrop: (corner) => this.dropArmedAt(corner),
          onCancel: () => this.disarm(),
        },
      );
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
    this.refreshPreview("rotate");
    this.scene.spinGhost("rotate");
  }

  private mirrorArmed(): void {
    if (!this.armed) return;
    this.armed = { ...this.armed, mirrored: !this.armed.mirrored };
    this.refreshGhost();
    this.refreshPreview("mirror");
    this.scene.spinGhost("mirror");
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "r" || event.key === "R") this.rotateArmed();
    else if (event.key === "f" || event.key === "F") this.mirrorArmed();
    // Échap désélectionne la gemme/le repère armé (retour utilisateur
    // direct) — même effet qu'un reclic sur la pièce déjà armée.
    else if (event.key === "Escape" && this.armed) this.disarm();
  };

  private handleCornerClick(corner: Position): boolean {
    // Cliquer une case déjà occupée par un repère le retire, qu'un
    // repère soit armé ou non — même logique que le placement réel.
    const existing = this.board.pieceAtCell(corner);
    if (existing) {
      this.board.removePiece(existing);
      this.scene.removeReflectionPiece(existing);
      this.freeGemSwatch(existing);
      this.setStatus("");
      return true;
    }
    if (!this.armed) return false;
    this.placeArmedAt(corner);
    return true;
  }

  /** Pose le repère actuellement armé sur `corner` — cœur commun au
   * clic (voir `handleCornerClick`) et au glisser-déposer (voir
   * `dropArmedAt`). */
  private placeArmedAt(corner: Position): boolean {
    if (!this.armed) return false;
    const positioned: Piece = { ...this.armed, origin: corner };
    const isGem = this.armedIsGem;
    let placed = false;
    try {
      if (isGem) {
        // Vraie hypothèse de placement : mêmes règles de contact que le
        // livret (retour utilisateur direct — un vrai bug permettait de
        // poser plusieurs gemmes les unes sur les autres).
        this.board.placePiece(positioned);
      } else {
        this.board.placePieceUnchecked(positioned);
      }
      this.scene.addReflectionPiece(positioned);
      this.setStatus("");
      placed = true;
      if (isGem) {
        const key = pieceKey(positioned);
        this.usedGemKeys.add(key);
        const swatch = this.gemSwatchByKey.get(key);
        if (swatch) swatch.disabled = true;
      }
    } catch (error) {
      this.setStatus(error instanceof PlacementError ? error.message : String(error));
    }
    // Une gemme posée (avec succès ou non) se désarme : il n'y en a
    // qu'une par couleur/forme à la fois, pas question d'en poser une
    // deuxième par-dessus au clic suivant (retour utilisateur direct).
    // Un repère élémentaire reste armé pour en poser plusieurs d'affilée
    // sans repasser par la palette.
    if (isGem) this.disarm();
    return placed;
  }

  /** Glisser-déposer (retour utilisateur direct) — voir
   * `placement-controller.ts:dropArmedAt` pour la même idée : dépose
   * SANS jamais retirer un repère déjà présent sur `corner`
   * (contrairement à `handleCornerClick`, pensé pour un simple clic). */
  private dropArmedAt(corner: Position): void {
    if (!this.armed) return;
    if (this.board.pieceAtCell(corner)) {
      this.setStatus("Case déjà occupée — impossible d'y déposer une pièce.");
      if (this.armedIsGem) this.disarm();
      return;
    }
    this.placeArmedAt(corner);
  }

  /** Repose la sélection après une pose de gemme (voir `handleCornerClick`)
   * ou un reclic sur une gemme/un repère déjà armé (voir le gestionnaire
   * de clic des boutons de palette, plus haut). Public : `multiplayer.ts`
   * l'appelle aussi en activant le mode marquage, pour qu'une croix et
   * une gemme/un repère ne puissent jamais être sélectionnés en même
   * temps (retour utilisateur direct — bug corrigé). Sans effet si rien
   * n'est déjà armé. */
  disarm(): void {
    this.armed = null;
    this.armedIsGem = false;
    this.updateSwatchSelection(null);
    this.refreshGhost();
    this.refreshPreview();
  }

  /** Arme `entry` — code commun au clic sur sa vignette et au début d'un
   * glisser-déposer (voir `makeSwatchDraggable`, `drag-drop.ts`). */
  private armEntry(entry: ReflectionPaletteEntry, kind: GemKind, isUnit: boolean, button: HTMLButtonElement): void {
    this.armed = {
      shape: entry.shape,
      kind,
      color: entry.color,
      origin: this.hoveredCorner ?? [0, 0],
      rotationSteps: 0,
      mirrored: false,
    };
    this.armedIsGem = !isUnit;
    this.updateSwatchSelection(button);
    this.refreshGhost();
    this.refreshPreview();
    this.options.onArm?.();
  }

  /** Si `piece` est une des 5 gemmes majeures/extensions actuellement
   * suivies comme "posée", libère sa case dans `usedGemKeys` et
   * réactive son bouton de palette — appelé quand on retire un repère
   * du plateau (voir `handleCornerClick`) ou qu'on vide tout
   * (`clearAll`). Ne fait rien pour un repère élémentaire (jamais
   * suivi ici). */
  private freeGemSwatch(piece: Piece): void {
    const key = pieceKey(piece);
    if (!this.usedGemKeys.delete(key)) return;
    const swatch = this.gemSwatchByKey.get(key);
    if (swatch) swatch.disabled = false;
  }

  private clearAll(): void {
    for (const piece of this.board.pieces()) {
      this.board.removePiece(piece);
      this.freeGemSwatch(piece);
    }
    this.scene.clearReflectionPieces();
    this.disarm();
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

  /** Cadre "APERÇU" (voir docstring de `previewHost`). `spin`, voir
   * `placement-controller.ts:refreshPreview` (même mécanique, retour
   * utilisateur direct — "une petite animation... sur l'aperçu"). */
  private refreshPreview(spin?: "rotate" | "mirror"): void {
    const host = this.options.previewHost;
    if (!host) return;
    if (!this.armed) {
      host.innerHTML = `<span class="orapa-place__preview-empty">Aucune gemme sélectionnée</span>`;
      return;
    }
    const icon = pieceIconSvg(this.armed.shape, this.armed.color, 76, this.armed.kind, this.armed.rotationSteps, this.armed.mirrored);
    const angle = (this.armed.rotationSteps * 90) % 360;
    const mirrorBadge = this.armed.mirrored ? `<span class="orapa-place__preview-angle orapa-place__preview-angle--mirror">⇋</span>` : "";
    const spinClass = spin ? ` orapa-place__preview-icon-wrap--spin-${spin}` : "";
    host.innerHTML = `<span class="orapa-place__preview-angle">${angle}°</span>${mirrorBadge}<span class="orapa-place__preview-icon-wrap${spinClass}">${icon}</span>`;
  }

  /** Validité du fantôme (vert/rouge au survol) : les règles complètes
   * du livret pour une gemme armée (`PreviewBoard.canPlace`, voir
   * docstring du module), seulement rester sur le plateau pour un
   * repère élémentaire (pas de contrôle de chevauchement). */
  private canPlace(piece: Piece): boolean {
    if (this.armedIsGem) return this.board.canPlace(piece);
    const quadrants = this.board.quadrants(piece);
    if (quadrants.size === 0) return false;
    for (const key of quadrants) {
      const [colStr, rowStr] = key.split(",");
      if (!this.board.contains([Number(colStr), Number(rowStr)])) return false;
    }
    return true;
  }

  private updateSwatchSelection(active: HTMLButtonElement | null): void {
    // `:not(.orapa-mp__mark-toggle)` : sa sélection visuelle à elle
    // (mode marquage actif ou non) est gérée par `multiplayer.ts`, pas
    // par l'armement d'une gemme/d'un repère — sans cette exclusion,
    // armer n'importe quelle autre pièce effaçait à tort son
    // "is-selected" (voir docstring de `markToggleButton`).
    for (const button of this.options.paletteHost.querySelectorAll<HTMLButtonElement>(".orapa-demo__swatch:not(.orapa-mp__mark-toggle)")) {
      button.classList.toggle("is-selected", button === active);
    }
  }

  private setStatus(message: string): void {
    if (this.options.statusHost) this.options.statusHost.textContent = message;
  }
}
