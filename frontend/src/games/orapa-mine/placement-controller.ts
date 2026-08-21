/**
 * Contrôleur de placement réutilisable : palette de pièces (icônes SVG
 * réelles, en liste façon "VOS GEMMES" — voir la maquette Claude
 * Design), pièce fantôme au survol, rotation/miroir (avec un aperçu 2D
 * qui reflète l'orientation en cours), placement aléatoire, pose/
 * retrait, validation une fois les pièces requises posées. Générique
 * par rapport à la source de vérité — voir `onPlace`/`onRemove`/
 * `onValidate` — pour servir à la fois pour :
 * - le placement de son propre plateau en Duel (la pose passe par le
 *   serveur, ce contrôleur ne fait que l'affichage local optimiste) ;
 * - la construction d'une proposition de solution (locale, envoyée
 *   d'un coup à la validation).
 *
 * Les pièces de `pieces` sont requises (comptées dans "X/N" pour
 * valider) ; celles de `extensionPieces` (Diamant, Corps noir) sont
 * optionnelles — posables ou non, elles ne bloquent jamais la
 * validation.
 */

import type { BoardScene } from "./board-scene";
import { pieceIconSvg } from "./piece-icon";
import { PlacementError, PreviewBoard } from "./preview-engine";
import { BASE_PIECE_PALETTE, GemKind, type Piece, type PieceShape, type Position } from "./types";

interface PaletteEntry {
  shape: PieceShape;
  kind: GemKind;
  color?: string;
  label: string;
  required: boolean;
}

function pieceKey(p: { shape: PieceShape; kind: GemKind; color?: string }): string {
  return `${p.shape}:${p.kind}:${p.color ?? ""}`;
}

export interface PlacementControllerOptions {
  scene: BoardScene;
  paletteHost: HTMLElement;
  rotateButton: HTMLButtonElement;
  mirrorButton: HTMLButtonElement;
  validateButton: HTMLButtonElement;
  statusHost?: HTMLElement;
  /** Cadre "APERÇU" (voir la maquette) : aperçu 2D, plus grand, de la
   * pièce actuellement armée — reflète pivot/miroir en direct. Absent
   * si non fourni (pas de régression pour un appelant qui ne le veut
   * pas). */
  previewHost?: HTMLElement;
  /** Bouton "Tout retirer" : optionnel, retire toutes les pièces déjà
   * posées (garde la palette utilisable ensuite). */
  clearButton?: HTMLButtonElement;
  /** Bouton "Au hasard" : optionnel, pose aléatoirement toutes les
   * pièces pas encore posées (essais aléatoires jusqu'à un placement
   * valide selon les règles du livret — voir `placeRandomly`). */
  randomButton?: HTMLButtonElement;
  /** Verbe affiché sur `validateButton` avant le compteur "(X/N)" —
   * ex. "Valider le placement" (défaut) ou "Proposer cette solution". */
  validateLabel?: string;
  pieces?: ReadonlyArray<{ shape: PieceShape; color: string; label: string }>;
  /** Diamant / Corps noir : optionnels, ne comptent pas dans "X/N". */
  extensionPieces?: ReadonlyArray<{ shape: PieceShape; kind: GemKind; label: string }>;
  /** Appelé après une pose locale réussie (ex : notifier le serveur). */
  onPlace?: (piece: Piece) => void;
  /** Appelé après un retrait local. */
  onRemove?: (piece: Piece) => void;
  /** Appelé quand toutes les pièces requises sont posées et la validation cliquée. */
  onValidate: (pieces: Piece[]) => void;
}

const RANDOM_PLACEMENT_ATTEMPTS = 400;

export class PlacementController {
  readonly board: PreviewBoard;
  private scene: BoardScene;
  private entries: PaletteEntry[];
  private requiredCount: number;
  private swatchByKey = new Map<string, HTMLButtonElement>();
  private statusByKey = new Map<string, HTMLElement>();
  private armed: Piece | null = null;
  private hoveredCorner: Position | null = null;
  private usedKeys = new Set<string>();
  private locked = false;
  private options: PlacementControllerOptions;

  constructor(options: PlacementControllerOptions) {
    this.options = options;
    this.scene = options.scene;
    const required = (options.pieces ?? BASE_PIECE_PALETTE).map((p) => ({ ...p, kind: GemKind.NORMAL, required: true }));
    const extensions = (options.extensionPieces ?? []).map((p) => ({ ...p, color: undefined, required: false }));
    this.entries = [...required, ...extensions];
    this.requiredCount = required.length;
    this.board = new PreviewBoard(this.scene.dimensions);

    // Liste "VOS GEMMES" (icône + libellé + statut), pas une simple
    // grille d'icônes — voir la maquette Claude Design.
    options.paletteHost.classList.add("orapa-demo__palette--list");
    for (const entry of this.entries) {
      const key = pieceKey(entry);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "orapa-demo__swatch";
      button.title = entry.label;
      const status = document.createElement("span");
      status.className = "orapa-demo__swatch-status";
      button.innerHTML = `
        <span class="orapa-demo__swatch-icon">${pieceIconSvg(entry.shape, entry.color, 32, entry.kind)}</span>
        <span class="orapa-demo__swatch-label">${entry.label}</span>
      `;
      button.appendChild(status);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        // Recliquer la gemme déjà armée la désélectionne plutôt que de la
        // réarmer inutilement (retour utilisateur direct : aucun moyen de
        // "relâcher" une pièce sans en armer une autre).
        if (button.classList.contains("is-selected")) {
          this.armed = null;
          this.updateSwatchSelection(null);
          this.refreshGhost();
          this.refreshPreview();
          return;
        }
        this.armed = {
          shape: entry.shape,
          kind: entry.kind,
          color: entry.color as Piece["color"],
          origin: this.hoveredCorner ?? [0, 0],
          rotationSteps: 0,
          mirrored: false,
        };
        this.updateSwatchSelection(button);
        this.refreshGhost();
        this.refreshPreview();
      });
      options.paletteHost.appendChild(button);
      this.swatchByKey.set(key, button);
      this.statusByKey.set(key, status);
    }

    options.rotateButton.addEventListener("click", () => this.rotateArmed());
    options.mirrorButton.addEventListener("click", () => this.mirrorArmed());
    options.clearButton?.addEventListener("click", () => this.clearAll());
    options.randomButton?.addEventListener("click", () => this.placeRandomly());
    options.validateButton.addEventListener("click", () => {
      if (this.requiredUsedCount() < this.requiredCount || this.locked) return;
      this.locked = true;
      this.armed = null;
      this.updateSwatchSelection(null);
      this.refreshGhost();
      this.refreshPreview();
      this.updateAvailability();
      this.options.onValidate(this.board.pieces());
    });

    this.activate();
    this.updateAvailability();
    this.refreshPreview();
  }

  /** (Ré)attache ce contrôleur aux callbacks de la scène — nécessaire
   * après qu'un autre contrôleur (ou un mode "question") les ait pris,
   * par exemple en repassant du mode "question" au mode "proposition"
   * sur le même `BoardScene` (voir `multiplayer.ts`). Réattache aussi le
   * raccourci clavier R/F : un `dispose()` le retire, donc sans ce
   * réattachement il resterait mort après un premier aller-retour
   * dispose/activate sur la même instance (même bug déjà corrigé dans
   * `reflection-controller.ts`, voir sa docstring). */
  activate(): void {
    this.scene.onCornerHover = (corner) => {
      this.hoveredCorner = corner;
      this.refreshGhost();
      // Survoler une pièce déjà posée la teinte en rouge : signale
      // qu'un clic la retirerait (retour utilisateur direct — ce
      // comportement existait déjà mais n'était pas visible).
      const existing = corner ? this.board.pieceAtCell(corner) : undefined;
      this.scene.setRemoveHighlight(this.locked ? null : (existing ?? null));
    };
    this.scene.onCornerClick = ({ corner }) => this.handleCornerClick(corner);
    document.addEventListener("keydown", this.handleKeyDown);
    this.scene.setPieces(this.board.pieces());
    this.refreshGhost();
  }

  /** Annule une pose optimiste rejetée par le serveur. */
  rejectPlacement(piece: Piece): void {
    this.board.removePiece(piece);
    this.usedKeys.delete(pieceKey(piece));
    this.scene.setPieces(this.board.pieces());
    this.updateAvailability();
  }

  dispose(): void {
    this.scene.onCornerHover = null;
    this.scene.onCornerClick = null;
    this.scene.setRemoveHighlight(null);
    document.removeEventListener("keydown", this.handleKeyDown);
  }

  private rotateArmed(): void {
    if (!this.armed || this.locked) return;
    this.armed = { ...this.armed, rotationSteps: (this.armed.rotationSteps + 1) % 4 };
    this.refreshGhost();
    this.refreshPreview();
  }

  private mirrorArmed(): void {
    if (!this.armed || this.locked) return;
    this.armed = { ...this.armed, mirrored: !this.armed.mirrored };
    this.refreshGhost();
    this.refreshPreview();
  }

  // Raccourcis clavier optionnels (R = pivoter, F = retourner), en plus
  // des boutons — plus rapide pour ajuster une pièce avant de la poser.
  // Ignorés si le focus est dans un champ texte (ex : le bloc-notes) ou
  // si aucune pièce n'est armée.
  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "r" || event.key === "R") this.rotateArmed();
    else if (event.key === "f" || event.key === "F") this.mirrorArmed();
  };

  private requiredUsedCount(): number {
    return this.entries.filter((e) => e.required && this.usedKeys.has(pieceKey(e))).length;
  }

  private handleCornerClick(corner: Position): void {
    if (this.locked) return;
    // Cliquer une case déjà occupée retire la pièce qui s'y trouve,
    // qu'une pièce soit armée ou non (voir docstring du module).
    const existing = this.board.pieceAtCell(corner);
    if (existing) {
      this.handlePieceClick(existing);
      return;
    }
    if (!this.armed) return;
    const positioned: Piece = { ...this.armed, origin: corner };
    try {
      this.board.placePiece(positioned);
      this.usedKeys.add(pieceKey(positioned));
      this.armed = null;
      this.updateSwatchSelection(null);
      this.scene.setPieces(this.board.pieces());
      this.refreshGhost();
      this.refreshPreview();
      this.updateAvailability();
      this.setStatus("");
      this.options.onPlace?.(positioned);
    } catch (error) {
      this.setStatus(error instanceof PlacementError ? error.message : String(error));
    }
  }

  private handlePieceClick(piece: Piece): void {
    if (this.locked) return;
    this.board.removePiece(piece);
    this.usedKeys.delete(pieceKey(piece));
    this.scene.setPieces(this.board.pieces());
    this.updateAvailability();
    this.setStatus("");
    this.options.onRemove?.(piece);
  }

  /** Retire toutes les pièces déjà posées (garde la palette utilisable
   * ensuite) — "Tout retirer" dans la maquette. */
  private clearAll(): void {
    if (this.locked) return;
    for (const piece of this.board.pieces()) {
      this.board.removePiece(piece);
      this.usedKeys.delete(pieceKey(piece));
      this.options.onRemove?.(piece);
    }
    this.armed = null;
    this.updateSwatchSelection(null);
    this.scene.setPieces(this.board.pieces());
    this.refreshGhost();
    this.refreshPreview();
    this.updateAvailability();
    this.setStatus("");
  }

  /** Pose aléatoirement toutes les pièces pas encore posées — "Au
   * hasard" dans la maquette. Tire une case, une rotation et un miroir
   * au hasard jusqu'à trouver un placement valide selon les règles du
   * livret (voir `PreviewBoard.canPlace`) ; abandonne cette pièce après
   * `RANDOM_PLACEMENT_ATTEMPTS` essais (rare, plateau très encombré) —
   * elle reste alors posable à la main comme avant. */
  private placeRandomly(): void {
    if (this.locked) return;
    const { width, height } = this.scene.dimensions;
    for (const entry of this.entries) {
      const key = pieceKey(entry);
      if (this.usedKeys.has(key)) continue;
      for (let attempt = 0; attempt < RANDOM_PLACEMENT_ATTEMPTS; attempt++) {
        const candidate: Piece = {
          shape: entry.shape,
          kind: entry.kind,
          color: entry.color as Piece["color"],
          origin: [Math.floor(Math.random() * width), Math.floor(Math.random() * height)],
          rotationSteps: Math.floor(Math.random() * 4),
          mirrored: Math.random() < 0.5,
        };
        if (!this.board.canPlace(candidate)) continue;
        this.board.placePiece(candidate);
        this.usedKeys.add(key);
        this.options.onPlace?.(candidate);
        break;
      }
    }
    this.armed = null;
    this.updateSwatchSelection(null);
    this.scene.setPieces(this.board.pieces());
    this.refreshGhost();
    this.refreshPreview();
    this.updateAvailability();
    this.setStatus("");
  }

  private refreshGhost(): void {
    if (!this.armed || this.locked) {
      this.scene.setGhost(null);
      return;
    }
    const positioned: Piece = { ...this.armed, origin: this.hoveredCorner ?? this.armed.origin };
    this.scene.setGhost(positioned, this.board.canPlace(positioned));
  }

  /** Cadre "APERÇU" (voir docstring de `previewHost`) : icône 2D plus
   * grande de la pièce armée, orientation courante comprise (badge
   * d'angle + indicateur miroir, comme la maquette). */
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

  private updateSwatchSelection(active: HTMLButtonElement | null): void {
    for (const button of this.swatchByKey.values()) {
      button.classList.toggle("is-selected", button === active);
    }
  }

  private updateAvailability(): void {
    for (const entry of this.entries) {
      const key = pieceKey(entry);
      const placed = this.usedKeys.has(key);
      const button = this.swatchByKey.get(key);
      if (button) button.disabled = this.locked || placed;
      const status = this.statusByKey.get(key);
      if (status) status.textContent = placed ? "posée" : "à poser";
    }
    const { rotateButton, mirrorButton, validateButton, clearButton, randomButton } = this.options;
    const requiredUsed = this.requiredUsedCount();
    const verb = this.options.validateLabel ?? "Valider le placement";
    validateButton.textContent = `${verb} (${requiredUsed}/${this.requiredCount})`;
    validateButton.disabled = this.locked || requiredUsed < this.requiredCount;
    rotateButton.disabled = this.locked;
    mirrorButton.disabled = this.locked;
    if (clearButton) clearButton.disabled = this.locked || this.usedKeys.size === 0;
    if (randomButton) randomButton.disabled = this.locked || this.usedKeys.size === this.entries.length;
  }

  private setStatus(message: string): void {
    if (this.options.statusHost) this.options.statusHost.textContent = message;
  }
}
