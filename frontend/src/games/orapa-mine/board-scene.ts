/**
 * Rendu 3D du plateau Orapa Mine (Three.js), style sobre / low-poly :
 * une grille plane, les vraies silhouettes des pièces extrudées en 3D,
 * des bornes d'entrée cliquables sur le pourtour, et un tracé de rayon.
 *
 * Ce module ne connaît aucune règle de jeu : il affiche un état de
 * plateau qu'on lui donne (`setPieces`, `setGhost`) et remonte les
 * interactions (survol, clic sur une case/pièce/borne d'entrée) via des
 * callbacks. La logique (validité d'un placement, résolution d'un tir)
 * vit ailleurs — voir `preview-engine.ts` pour la démo hors ligne, et
 * docs/plan.md pour le rappel qu'en multijoueur cette logique doit
 * rester côté serveur.
 *
 * Trois groupes de pièces coexistent, indépendants : `pieceGroup`
 * (état RÉEL du plateau, via `setPieces`), `reflectionGroup` (repères
 * personnels du joueur, via `addReflectionPiece` — jamais effacés par
 * `setPieces`), et le fantôme de placement (`setGhost`, un seul à la
 * fois, dans `pieceGroup`).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Entry, LabelScheme } from "./borders";
import type { Point } from "./geometry";
import type { RayStep } from "./preview-engine";
import {
  type BoardDimensions,
  DEFAULT_DIMENSIONS,
  GEM_DISPLAY_COLOR,
  GemKind,
  type Piece,
  type Position,
} from "./types";
import { vertices as pieceVertices } from "./piece-render";

const GEM_HEIGHT = 0.5;
const GHOST_OPACITY = 0.55;
const REFLECTION_OPACITY = 0.7;
const RAY_HEIGHT = 0.32;
const ENTRY_MARKER_DEFAULT_COLOR = 0x6b7280;

type PieceMeshStyle = "solid" | "ghost" | "reflection";

export const RAY_COLOR_HEX: Record<string, number> = {
  transparent: 0x9aa0a6,
  rouge: 0xd64545,
  jaune: 0xe0c23c,
  bleu: 0x3f7fd6,
  blanc: 0xe8e6df,
  rose: 0xe98fa6,
  "jaune clair": 0xefe08a,
  "bleu clair": 0x9dc3ec,
  orange: 0xe08a3c,
  vert: 0x4caf6e,
  violet: 0x8a5fd6,
  gris: 0x8a8f96,
  "orange clair": 0xf0c79a,
  "vert clair": 0xa8dcb6,
  "violet clair": 0xc6b0ec,
  noir: 0x2f2f2f,
  absorbé: 0x1a1a1a,
};

export interface CornerClickEvent {
  corner: Position;
}

export interface EntryClickEvent {
  label: string;
  entry: Entry;
}

export class BoardScene {
  readonly dimensions: BoardDimensions;

  onCornerClick: ((event: CornerClickEvent) => void) | null = null;
  onEntryClick: ((event: EntryClickEvent) => void) | null = null;
  onCornerHover: ((corner: Position | null) => void) | null = null;

  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private labelScheme: LabelScheme;

  private pieceGroup = new THREE.Group();
  private pieceMeshes = new Map<Piece, THREE.Object3D>();
  private ghostMesh: THREE.Object3D | null = null;
  private ghostValid = true;
  private rayGroup = new THREE.Group();
  // Croix personnelles posées par le joueur pour s'aider (voir
  // `toggleMark`) : purement visuel, jamais transmis au serveur ni à
  // l'adversaire — indépendant de tout état de jeu.
  private markGroup = new THREE.Group();
  private marks = new Map<string, THREE.Object3D>();
  // Pièces de réflexion (voir `reflection-controller.ts`) : des repères
  // personnels, groupe séparé de `pieceGroup` pour ne jamais être
  // effacées par `setPieces` (qui affiche l'état RÉEL du plateau — vide
  // en mode question, alors que ces repères doivent y rester visibles).
  private reflectionGroup = new THREE.Group();
  private reflectionMeshes = new Map<Piece, THREE.Object3D>();
  // Survol d'une pièce déjà posée (réelle ou de réflexion) : teinte
  // temporairement son maillage pour signaler qu'un clic la retirerait
  // (voir `setRemoveHighlight`).
  private removeHighlightMesh: THREE.Object3D | null = null;
  private removeHighlightOriginalColor: number | null = null;
  // Plan mathématique y=0 pour le survol/clic de case : plus robuste que
  // de rayonner contre le maillage des pièces ou du sol (déjà utilisés
  // pour le rendu), qui peut produire des intersections ambiguës en
  // rasant le bord d'une grande pièce — a causé un vrai bug de clics
  // manqués près de pièces volumineuses (voir docs/plan.md).
  private groundMathPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private entryTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver;
  private animationHandle = 0;

  constructor(container: HTMLElement, dimensions: BoardDimensions = DEFAULT_DIMENSIONS) {
    this.container = container;
    this.dimensions = dimensions;
    this.labelScheme = new LabelScheme(dimensions);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f4f6);

    const { clientWidth, clientHeight } = container;
    this.camera = new THREE.PerspectiveCamera(45, clientWidth / Math.max(clientHeight, 1), 0.1, 100);
    const span = Math.max(dimensions.width, dimensions.height);
    this.camera.position.set(span * 0.55, span * 0.95, span * 0.85);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(clientWidth, clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = span * 0.6;
    this.controls.maxDistance = span * 2.2;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(4, 8, 3);
    this.scene.add(sun);

    this.buildGrid();
    this.buildEntryMarkers();
    this.scene.add(this.pieceGroup);
    this.scene.add(this.rayGroup);
    this.scene.add(this.markGroup);
    this.scene.add(this.reflectionGroup);

    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.tick();
  }

  /** Remplace toutes les pièces affichées par `pieces`. */
  setPieces(pieces: Piece[]): void {
    for (const mesh of this.pieceMeshes.values()) this.pieceGroup.remove(mesh);
    this.pieceMeshes.clear();
    // Les maillages ci-dessus disparaissent : toute référence à l'un
    // d'eux pour la surbrillance "retirer" serait périmée.
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;

    for (const piece of pieces) {
      const mesh = this.buildPieceMesh(piece, "solid");
      mesh.userData.piece = piece;
      this.pieceGroup.add(mesh);
      this.pieceMeshes.set(piece, mesh);
    }
  }

  /** Affiche (ou met à jour) une pièce fantôme semi-transparente — la
   * pièce en cours de placement. `null` la masque. */
  setGhost(piece: Piece | null, valid: boolean = true): void {
    if (this.ghostMesh) {
      this.pieceGroup.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    if (!piece) return;
    this.ghostValid = valid;
    this.ghostMesh = this.buildPieceMesh(piece, "ghost");
    this.pieceGroup.add(this.ghostMesh);
  }

  /** Ajoute une pièce de réflexion (voir `reflection-controller.ts`) —
   * groupe séparé de `setPieces`, jamais effacé par lui. Légèrement
   * transparente pour se distinguer d'une vraie pièce posée. */
  addReflectionPiece(piece: Piece): void {
    const mesh = this.buildPieceMesh(piece, "reflection");
    mesh.userData.piece = piece;
    this.reflectionGroup.add(mesh);
    this.reflectionMeshes.set(piece, mesh);
  }

  removeReflectionPiece(piece: Piece): void {
    const mesh = this.reflectionMeshes.get(piece);
    if (!mesh) return;
    this.reflectionGroup.remove(mesh);
    this.reflectionMeshes.delete(piece);
    if (this.removeHighlightMesh === mesh) {
      this.removeHighlightMesh = null;
      this.removeHighlightOriginalColor = null;
    }
  }

  clearReflectionPieces(): void {
    this.reflectionGroup.clear();
    this.reflectionMeshes.clear();
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;
  }

  /** Trace le chemin d'un rayon. `entry` et les positions de `steps`
   * doivent être des coordonnées déjà CONTINUES (voir
   * `geometry.toContinuousCorner` pour convertir un point d'entrée/
   * sortie discret — ceux de `preview-engine.fireRayPreview` le sont
   * déjà). Mélanger discret et continu décale le tracé d'une demi-case. */
  animateRay(entry: Point, steps: RayStep[], colorName: string): void {
    this.rayGroup.clear();
    const points = [entry, ...steps.map((s) => s.position)].map((p) => {
      const c = this.continuousToWorld(p);
      return new THREE.Vector3(c.x, RAY_HEIGHT, c.z);
    });

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const color = RAY_COLOR_HEX[colorName] ?? 0x666666;
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
    this.rayGroup.add(line);

    for (const point of points) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color }));
      dot.position.copy(point);
      this.rayGroup.add(dot);
    }
  }

  clearRay(): void {
    this.rayGroup.clear();
  }

  /** Pose ou retire une croix personnelle sur `corner` (case du plateau,
   * pas un bord) — purement local, voir la docstring du champ `marks`.
   * Ne fait rien si `corner` tombe hors du plateau (retour utilisateur
   * direct : on pouvait marquer des cases inexistantes). Renvoie `true`
   * si la case est désormais marquée. */
  toggleMark(corner: Position): boolean {
    if (!this.containsCell(corner)) return false;
    const key = `${corner[0]},${corner[1]}`;
    const existing = this.marks.get(key);
    if (existing) {
      this.markGroup.remove(existing);
      this.marks.delete(key);
      return false;
    }
    const mark = buildCrossMark();
    const center = this.cornerAverageWorld(corner);
    mark.position.set(center.x, 0.03, center.z);
    this.markGroup.add(mark);
    this.marks.set(key, mark);
    return true;
  }

  private containsCell([col, row]: Position): boolean {
    return col >= 0 && col < this.dimensions.width && row >= 0 && row < this.dimensions.height;
  }

  clearMarks(): void {
    this.markGroup.clear();
    this.marks.clear();
  }

  /** Teinte durablement la borne `label` (entrée ou sortie d'un rayon)
   * selon `colorName` — reste coloré tant que la scène existe (jusqu'à
   * `clearMarkerColors()`), plutôt qu'un tracé qui disparaîtrait au tir
   * suivant : pour un plateau fixe, une borne donnée ne peut produire
   * qu'une seule couleur, donc la teinter durablement construit
   * naturellement une carte des questions déjà posées (voir
   * `multiplayer.ts`, remplace l'ancien tracé ligne par ligne — retour
   * utilisateur direct, l'ancien tracé masquait le précédent à chaque
   * nouveau tir). Ne fait rien si `label` ne correspond à aucune borne. */
  colorEntryMarker(label: string, colorName: string): void {
    const marker = this.entryTargets.find((m) => m.userData.label === label);
    if (!marker) return;
    const material = (marker as THREE.Mesh).material as THREE.MeshStandardMaterial;
    material.color.setHex(RAY_COLOR_HEX[colorName] ?? ENTRY_MARKER_DEFAULT_COLOR);
  }

  /** Remet toutes les bornes à leur couleur neutre (ex : au début d'une
   * nouvelle partie sur la même scène). */
  clearMarkerColors(): void {
    for (const marker of this.entryTargets) {
      const material = (marker as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.color.setHex(ENTRY_MARKER_DEFAULT_COLOR);
    }
  }

  /** Teinte le maillage de `piece` (pièce réelle ou de réflexion) pour
   * signaler qu'un clic dessus la retirerait (voir
   * `placement-controller.ts` / `reflection-controller.ts`) ; `null`
   * efface la surbrillance en cours. Un seul maillage à la fois. */
  setRemoveHighlight(piece: Piece | null): void {
    if (this.removeHighlightMesh && this.removeHighlightOriginalColor !== null) {
      const material = (this.removeHighlightMesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.color.setHex(this.removeHighlightOriginalColor);
    }
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;
    if (!piece) return;
    const mesh = this.pieceMeshes.get(piece) ?? this.reflectionMeshes.get(piece);
    if (!mesh) return;
    const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    this.removeHighlightOriginalColor = material.color.getHex();
    material.color.lerp(new THREE.Color(0xe74c3c), 0.55);
    this.removeHighlightMesh = mesh;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationHandle);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** Ré-attache le `<canvas>` existant à un nouveau conteneur — utile
   * quand l'écran qui l'héberge est reconstruit dans le DOM (voir
   * `multiplayer.ts`) sans vouloir recréer toute la scène 3D. */
  attachTo(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.handleResize();
    this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  /** (col, row) de case/bord DISCRÈTE -> centre de cette case, en
   * position monde (y=0). Pour les bornes d'entrée et tout indice de
   * case entier — pas pour le tracé d'un rayon, voir `continuousToWorld`. */
  private cornerAverageWorld([col, row]: Point): THREE.Vector3 {
    const x = col - this.dimensions.width / 2 + 0.5;
    const z = row - this.dimensions.height / 2 + 0.5;
    return new THREE.Vector3(x, 0, z);
  }

  /** Coordonnée déjà CONTINUE (potentiellement à mi-case, ex : un point
   * de rebond d'un rayon) -> position monde. Contrairement à
   * `cornerAverageWorld`, n'ajoute aucun centrage : l'appelant doit
   * avoir converti toute position discrète au préalable (voir
   * `geometry.toContinuousCorner`), sans quoi le tracé se décale d'une
   * demi-case (bug corrigé une fois — voir docs/plan.md). */
  private continuousToWorld([x, z]: Point): THREE.Vector3 {
    return new THREE.Vector3(x - this.dimensions.width / 2, 0, z - this.dimensions.height / 2);
  }

  private buildGrid(): void {
    const { width, height } = this.dimensions;
    const halfW = width / 2;
    const halfH = height / 2;

    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ color: 0xe4e4e8, roughness: 0.9 }),
    );
    base.rotation.x = -Math.PI / 2;
    this.scene.add(base);

    const linePositions: number[] = [];
    for (let c = 0; c <= width; c++) {
      linePositions.push(c - halfW, 0.001, -halfH, c - halfW, 0.001, halfH);
    }
    for (let r = 0; r <= height; r++) {
      linePositions.push(-halfW, 0.001, r - halfH, halfW, 0.001, r - halfH);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0xb5b5bd }));
    this.scene.add(lines);
  }

  private buildEntryMarkers(): void {
    for (const { label, entry } of this.labelScheme.allEntries()) {
      const center = this.cornerAverageWorld(entry.position);

      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: ENTRY_MARKER_DEFAULT_COLOR }),
      );
      marker.position.set(center.x, 0.06, center.z);
      marker.userData.label = label;
      marker.userData.entry = entry;
      this.entryTargets.push(marker);
      this.scene.add(marker);

      const sprite = makeTextSprite(label);
      sprite.position.set(center.x, 0.45, center.z);
      this.scene.add(sprite);
    }
  }

  private buildPieceMesh(piece: Piece, style: PieceMeshStyle): THREE.Object3D {
    const isGhost = style === "ghost";
    const isReflection = style === "reflection";
    const verts = pieceVertices(piece);
    const shape = new THREE.Shape();
    verts.forEach(([col, row], i) => {
      const x = col - this.dimensions.width / 2;
      const y = -(row - this.dimensions.height / 2); // voir board-scene.ts docstring : compense la rotation -90° autour de X
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: GEM_HEIGHT, bevelEnabled: false });

    const isDiamond = piece.kind === GemKind.DIAMOND;
    const isBlackBody = piece.kind === GemKind.BLACK_BODY;
    const color = isDiamond ? 0xbfe3f0 : isBlackBody ? 0x1a1a1a : piece.color ? GEM_DISPLAY_COLOR[piece.color] : 0x999999;
    const transparent = isGhost || isReflection || isDiamond;
    const opacity = isGhost ? GHOST_OPACITY : isReflection ? REFLECTION_OPACITY : isDiamond ? 0.5 : 1;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: isDiamond ? 0.15 : isBlackBody ? 0.6 : 0.35,
      transparent,
      opacity,
    });
    if (isGhost) this.tintGhost(material);
    const mesh = new THREE.Mesh(geometry, material);
    // Contour sombre : sans lui, une pièce blanche se distingue mal du
    // sol clair du plateau (retour utilisateur direct sur ce point).
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 20),
      new THREE.LineBasicMaterial({ color: 0x3a3a38, transparent, opacity }),
    );
    mesh.add(edges);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private tintGhost(material: THREE.MeshStandardMaterial): void {
    material.color.lerp(new THREE.Color(this.ghostValid ? 0x2ecc71 : 0xe74c3c), 0.45);
  }

  private handleClick = (event: MouseEvent): void => {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const entryHit = this.raycaster.intersectObjects(this.entryTargets, false)[0];
    if (entryHit) {
      const { label, entry } = entryHit.object.userData as { label: string; entry: Entry };
      this.onEntryClick?.({ label, entry });
      return;
    }

    // Une seule notion de "case cliquée", que ce soit pour poser ou pour
    // retirer une pièce : à l'appelant (voir `placement-controller.ts`)
    // de regarder ce qu'il y a à cette case et de décider quoi faire.
    const corner = this.cornerUnderPointer();
    if (corner) this.onCornerClick?.({ corner });
  };

  private handlePointerMove = (event: MouseEvent): void => {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.onCornerHover?.(this.cornerUnderPointer());
  };

  /** Case du plateau sous le curseur, via l'intersection avec le plan
   * mathématique y=0 (voir `groundMathPlane`) plutôt que le maillage du
   * sol — insensible à l'ordre/l'état des autres objets de la scène.
   *
   * `Math.floor`, pas `Math.round` : une case (col, row) occupe le
   * carré [col, col+1)×[row, row+1) au sol, donc c'est l'indice dont ce
   * carré contient le point cliqué qu'il faut renvoyer. `Math.round`
   * arrondissait plutôt au SOMMET de grille le plus proche — invisible
   * pour poser une pièce (le fantôme au survol montre déjà exactement
   * le résultat, donc toujours cohérent avec lui-même), mais un vrai bug
   * pour une croix ou une question posée sur une case : cliquer near le
   * centre visuel d'une case pouvait arrondir vers la case voisine
   * (`Math.round` arrondit .5 vers le haut), d'où le décalage rapporté
   * par l'utilisateur — d'autant plus visible que l'angle de caméra est
   * oblique (même écart en coordonnées monde, mais plus grand à l'écran
   * sous une perspective rasante). */
  private cornerUnderPointer(): Position | null {
    const point = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundMathPlane, point);
    if (!hit) return null;
    const col = Math.floor(point.x + this.dimensions.width / 2);
    const row = Math.floor(point.z + this.dimensions.height / 2);
    return [col, row];
  }

  private updatePointer(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }

  private tick = (): void => {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationHandle = requestAnimationFrame(this.tick);
  };
}

function buildCrossMark(): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0xe74c3c });
  const half = 0.3;
  const diagonal1 = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-half, 0, -half),
    new THREE.Vector3(half, 0, half),
  ]);
  const diagonal2 = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-half, 0, half),
    new THREE.Vector3(half, 0, -half),
  ]);
  group.add(new THREE.Line(diagonal1, material));
  group.add(new THREE.Line(diagonal2, material));
  return group;
}

function makeTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 34);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.4, 0.4, 1);
  return sprite;
}
