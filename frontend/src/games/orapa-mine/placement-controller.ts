/**
 * Contrôleur de placement réutilisable : palette de pièces (icônes SVG
 * réelles), pièce fantôme au survol, rotation/miroir, pose/retrait,
 * validation une fois toutes les pièces posées. Générique par rapport à
 * la source de vérité — voir `onPlace`/`onRemove`/`onValidate` — pour
 * servir à la fois pour :
 * - le placement de son propre plateau en Duel (la pose passe par le
 *   serveur, ce contrôleur ne fait que l'affichage local optimiste) ;
 * - la construction d'une proposition de solution (locale, envoyée
 *   d'un coup à la validation).
 *
 * Extrait de la démo hors ligne (`demo.ts`) pour être partagé — voir
 * celle-ci pour la version autonome d'origine.
 */

import type { BoardScene } from "./board-scene";
import { pieceIconSvg } from "./piece-icon";
import { PlacementError, PreviewBoard } from "./preview-engine";
import { BASE_PIECE_PALETTE, GemKind, type Piece, type PieceShape, type Position } from "./types";

function paletteKey(shape: PieceShape, color: string): string {
  return `${shape}:${color}`;
}

export interface PlacementControllerOptions {
  scene: BoardScene;
  paletteHost: HTMLElement;
  rotateButton: HTMLButtonElement;
  mirrorButton: HTMLButtonElement;
  validateButton: HTMLButtonElement;
  statusHost?: HTMLElement;
  pieces?: ReadonlyArray<{ shape: PieceShape; color: string; label: string }>;
  /** Appelé après une pose locale réussie (ex : notifier le serveur). */
  onPlace?: (piece: Piece) => void;
  /** Appelé après un retrait local. */
  onRemove?: (piece: Piece) => void;
  /** Appelé quand toutes les pièces sont posées et la validation cliquée. */
  onValidate: (pieces: Piece[]) => void;
}

export class PlacementController {
  readonly board: PreviewBoard;
  private scene: BoardScene;
  private pieces: ReadonlyArray<{ shape: PieceShape; color: string; label: string }>;
  private swatchByKey = new Map<string, HTMLButtonElement>();
  private armed: Piece | null = null;
  private hoveredCorner: Position | null = null;
  private usedKeys = new Set<string>();
  private locked = false;
  private options: PlacementControllerOptions;

  constructor(options: PlacementControllerOptions) {
    this.options = options;
    this.scene = options.scene;
    this.pieces = options.pieces ?? BASE_PIECE_PALETTE;
    this.board = new PreviewBoard(this.scene.dimensions);

    for (const { shape, color, label } of this.pieces) {
      const key = paletteKey(shape, color);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "orapa-demo__swatch";
      button.title = label;
      button.innerHTML = pieceIconSvg(shape, color);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        this.armed = {
          shape,
          kind: GemKind.NORMAL,
          color: color as Piece["color"],
          origin: this.hoveredCorner ?? [0, 0],
          rotationSteps: 0,
          mirrored: false,
        };
        this.updateSwatchSelection(button);
        this.refreshGhost();
      });
      options.paletteHost.appendChild(button);
      this.swatchByKey.set(key, button);
    }

    options.rotateButton.addEventListener("click", () => {
      if (!this.armed) return;
      this.armed = { ...this.armed, rotationSteps: (this.armed.rotationSteps + 1) % 4 };
      this.refreshGhost();
    });
    options.mirrorButton.addEventListener("click", () => {
      if (!this.armed) return;
      this.armed = { ...this.armed, mirrored: !this.armed.mirrored };
      this.refreshGhost();
    });
    options.validateButton.addEventListener("click", () => {
      if (this.usedKeys.size < this.pieces.length || this.locked) return;
      this.locked = true;
      this.armed = null;
      this.updateSwatchSelection(null);
      this.refreshGhost();
      this.updateAvailability();
      this.options.onValidate(this.board.pieces());
    });

    this.activate();
    this.updateAvailability();
  }

  /** (Ré)attache ce contrôleur aux callbacks de la scène — nécessaire
   * après qu'un autre contrôleur (ou un mode "question") les ait pris,
   * par exemple en repassant du mode "question" au mode "proposition"
   * sur le même `BoardScene` (voir `multiplayer.ts`). */
  activate(): void {
    this.scene.onCornerHover = (corner) => {
      this.hoveredCorner = corner;
      this.refreshGhost();
    };
    this.scene.onCornerClick = ({ corner }) => this.handleCornerClick(corner);
    this.scene.setPieces(this.board.pieces());
    this.refreshGhost();
  }

  /** Annule une pose optimiste rejetée par le serveur. */
  rejectPlacement(piece: Piece): void {
    this.board.removePiece(piece);
    this.usedKeys.delete(paletteKey(piece.shape, piece.color!));
    this.scene.setPieces(this.board.pieces());
    this.updateAvailability();
  }

  dispose(): void {
    this.scene.onCornerHover = null;
    this.scene.onCornerClick = null;
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
      this.usedKeys.add(paletteKey(positioned.shape, positioned.color!));
      this.armed = null;
      this.updateSwatchSelection(null);
      this.scene.setPieces(this.board.pieces());
      this.refreshGhost();
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
    this.usedKeys.delete(paletteKey(piece.shape, piece.color!));
    this.scene.setPieces(this.board.pieces());
    this.updateAvailability();
    this.setStatus("");
    this.options.onRemove?.(piece);
  }

  private refreshGhost(): void {
    if (!this.armed || this.locked) {
      this.scene.setGhost(null);
      return;
    }
    const positioned: Piece = { ...this.armed, origin: this.hoveredCorner ?? this.armed.origin };
    this.scene.setGhost(positioned, this.board.canPlace(positioned));
  }

  private updateSwatchSelection(active: HTMLButtonElement | null): void {
    for (const button of this.swatchByKey.values()) {
      button.classList.toggle("is-selected", button === active);
    }
  }

  private updateAvailability(): void {
    for (const [key, button] of this.swatchByKey) {
      button.disabled = this.locked || this.usedKeys.has(key);
    }
    const { rotateButton, mirrorButton, validateButton } = this.options;
    validateButton.textContent = `Valider le placement (${this.usedKeys.size}/${this.pieces.length})`;
    validateButton.disabled = this.locked || this.usedKeys.size < this.pieces.length;
    rotateButton.disabled = this.locked;
    mirrorButton.disabled = this.locked;
  }

  private setStatus(message: string): void {
    if (this.options.statusHost) this.options.statusHost.textContent = message;
  }
}
