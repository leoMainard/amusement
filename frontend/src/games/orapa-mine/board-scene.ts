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
// Palette reprise de la maquette Claude Design (`claude_design/orapa-board.js`),
// bornes éclaircies (retour utilisateur direct — trop sombres/peu
// visibles sur le plateau, "idem" que le blanc des gemmes).
const ENTRY_MARKER_DEFAULT_COLOR = 0x3c528c;
const ENTRY_MARKER_HOVER_COLOR = 0xf2c24b;
const TILE_DARK = 0x0c1636;
const TILE_LIGHT = 0x11204c;
const TILE_EMISSIVE_IDLE = 0x0a1b3d;
const TILE_EMISSIVE_HOVER = 0xf2c24b;
const TILE_BASE_Y = -0.07;
const TILE_HOVER_Y = -0.02;
const ENTRY_BASE_Y = 0.06;
const ENTRY_HOVER_Y = 0.18;
const HOVER_LERP_SPEED = 0.22;
// Distance entre le bord des cases et le centre d'une borne d'entrée
// (voir `continuousToWorld`) : assez petite pour que la borne touche
// visiblement le plateau, en laissant sa moitié la plus large (0.22 de
// rayon, voir `buildEntryMarkers`) légèrement chevaucher le bord plutôt
// que de s'arrêter pile dessus — retour utilisateur direct ("il y a un
// léger espace actuellement").
const ENTRY_TOUCH_OFFSET = 0.15;

type PieceMeshStyle = "solid" | "ghost" | "reflection";

// Reprises de la maquette Claude Design (`claude_design/orapa-board.js`,
// table `COLOR_RESULTS`) — mêmes teintes que les gemmes elles-mêmes
// (`types.ts:GEM_DISPLAY_COLOR`) pour rester cohérent.
export const RAY_COLOR_HEX: Record<string, number> = {
  transparent: 0x9aa0a6,
  rouge: 0xe83c30,
  jaune: 0xf2c24b,
  bleu: 0x2f7ff0,
  blanc: 0xf4ead6,
  rose: 0xf09fb2,
  "jaune clair": 0xf8de9c,
  "bleu clair": 0x8ab7ef,
  orange: 0xe8873a,
  vert: 0x5aa860,
  violet: 0x8a5fc0,
  gris: 0x9aa3b8,
  "orange clair": 0xf0b57e,
  "vert clair": 0x98cf9d,
  "violet clair": 0xb899e0,
  noir: 0x141a2c,
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
  private pieceMeshes = new Map<Piece, THREE.Mesh>();
  private ghostMesh: THREE.Mesh | null = null;
  private ghostValid = true;
  private rayGroup = new THREE.Group();
  // Tracé du rayon : tube + point lumineux animé le long de son
  // parcours (voir `animateRay`/`tick`, style repris de la maquette).
  private rayCurve: THREE.CurvePath<THREE.Vector3> | null = null;
  private rayDot: THREE.Mesh | null = null;
  private rayT = 0;
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
  private reflectionMeshes = new Map<Piece, THREE.Mesh>();
  // Survol d'une pièce déjà posée (réelle ou de réflexion) : teinte
  // temporairement son maillage pour signaler qu'un clic la retirerait
  // (voir `setRemoveHighlight`).
  private removeHighlightMesh: THREE.Mesh | null = null;
  private removeHighlightOriginalColor: number | null = null;
  // Plan mathématique y=0 pour le survol/clic de case : plus robuste que
  // de rayonner contre le maillage des pièces ou du sol (déjà utilisés
  // pour le rendu), qui peut produire des intersections ambiguës en
  // rasant le bord d'une grande pièce — a causé un vrai bug de clics
  // manqués près de pièces volumineuses (voir docs/plan.md).
  private groundMathPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Cases du plateau (voir `buildGrid`) et bornes d'entrée : animées au
  // survol (lueur + léger soulèvement, voir `tick`) — l'état survolé
  // n'est recalculé qu'au déplacement de la souris (`handlePointerMove`),
  // pas à chaque frame, pour ne pas reconstruire le fantôme de
  // placement 60 fois par seconde (`onCornerHover` doit rester rare).
  private tiles: THREE.Mesh[] = [];
  private hoveredTileCorner: Position | null = null;
  private hoveredEntryMesh: THREE.Object3D | null = null;
  private markerIdleColor = new Map<THREE.Object3D, number>();

  private entryTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver;
  private animationHandle = 0;
  // `THREE.Timer` plutôt que l'ancien `THREE.Clock` (déprécié depuis
  // three.js — avertissement console à chaque scène montée, retour
  // utilisateur direct : "il y'a toujours des warnings"). Contrairement à
  // `Clock`, `Timer` exige un `update()` explicite par frame avant de lire
  // `getDelta()`/`getElapsed()` (voir `tick`).
  private timer = new THREE.Timer();
  // Position à l'appui du bouton, pour distinguer un vrai clic d'un
  // relâchement après avoir fait tourner la vue à la souris. Le DOM
  // déclenche quand même un "click" natif tant que l'appui et le
  // relâchement ciblent le même élément — même après un déplacement
  // important entre les deux — ce qui armait à tort une question sur la
  // case survolée en fin de rotation (retour utilisateur direct).
  private pointerDownPosition: { x: number; y: number } | null = null;
  private static readonly CLICK_DRAG_THRESHOLD_PX = 6;

  constructor(container: HTMLElement, dimensions: BoardDimensions = DEFAULT_DIMENSIONS) {
    this.container = container;
    this.dimensions = dimensions;
    this.labelScheme = new LabelScheme(dimensions);

    this.scene = new THREE.Scene();
    // Pas de fond opaque : le canevas est transparent (voir `alpha:
    // true` ci-dessous), le dégradé bleu nuit vient du CSS du
    // conteneur (`.orapa-demo__canvas`/`.guide__canvas`), comme dans la
    // maquette Claude Design.

    const { clientWidth, clientHeight } = container;
    this.camera = new THREE.PerspectiveCamera(45, clientWidth / Math.max(clientHeight, 1), 0.1, 100);
    const span = Math.max(dimensions.width, dimensions.height);
    this.camera.position.set(span * 0.55, span * 0.95, span * 0.85);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(clientWidth, clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = span * 0.6;
    this.controls.maxDistance = span * 2.2;

    // Un peu plus lumineux que la maquette Claude Design d'origine
    // (retour utilisateur direct — "le plateau est un peu sombre") :
    // intensités relevées, et les matériaux du plateau (voir `buildGrid`/
    // `buildBoardBody`/`buildEntryMarkers`) légèrement moins rugueux pour
    // que ces lumières se reflètent davantage dessus.
    this.scene.add(new THREE.HemisphereLight(0x8fa4d8, 0x070e26, 1.05));
    const sun = new THREE.DirectionalLight(0xffe6b0, 1.65);
    sun.position.set(4, 8, 3);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5f86e0, 0.9);
    fill.position.set(-6, 6, -6);
    this.scene.add(fill);

    this.buildGrid();
    this.buildEntryMarkers();
    this.scene.add(this.pieceGroup);
    this.scene.add(this.rayGroup);
    this.scene.add(this.markGroup);
    this.scene.add(this.reflectionGroup);

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.tick();
  }

  /** Libère la géométrie/le matériau d'un maillage de pièce avant de le
   * retirer de la scène — `Object3D.remove()` seul ne fait que le
   * détacher du graphe de scène, la géométrie/le matériau créés par
   * `buildPieceMesh` (un `ExtrudeGeometry` + `MeshPhysicalMaterial` par
   * pièce) restaient sinon en mémoire GPU indéfiniment. Un vrai bug —
   * poser/retirer des pièces plusieurs fois (ex. "Tout retirer" en
   * placement Duel) finissait par déclencher de nombreux avertissements
   * du pilote graphique, signalés par un retour utilisateur direct. */
  private disposePieceMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  /** Remplace toutes les pièces affichées par `pieces`. `found`, si
   * fourni, teinte chaque pièce en vert (trouvée) ou rouge (manquée) —
   * écran de résultats (retour utilisateur direct : "l'ensemble des
   * pièces avec marqué trouvé ou manqué en rouge ou en vert"), absent
   * sinon (rendu normal, couleur propre de la pièce). */
  setPieces(pieces: Piece[], found?: Map<Piece, boolean>): void {
    for (const mesh of this.pieceMeshes.values()) {
      this.pieceGroup.remove(mesh);
      this.disposePieceMesh(mesh);
    }
    this.pieceMeshes.clear();
    // Les maillages ci-dessus disparaissent : toute référence à l'un
    // d'eux pour la surbrillance "retirer" serait périmée.
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;

    for (const piece of pieces) {
      const mesh = this.buildPieceMesh(piece, "solid");
      mesh.userData.piece = piece;
      const status = found?.get(piece);
      if (status !== undefined) {
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        const tint = new THREE.Color(status ? 0x2ecc71 : 0xe74c3c);
        material.color.lerp(tint, 0.6);
        material.emissive = tint;
        material.emissiveIntensity = 0.3;
      }
      this.pieceGroup.add(mesh);
      this.pieceMeshes.set(piece, mesh);
    }
  }

  /** Écran de résultats (retour utilisateur direct) : plateau consultable
   * (glisser/zoomer reste possible) mais rien à y poser/interroger —
   * `false` désactive aussi la rotation manuelle, pour un plateau
   * purement décoratif qui tourne tout seul (voir `setAutoRotate`). */
  setInteractive(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Légère rotation automatique autour du plateau (écran de résultats,
   * retour utilisateur direct — "il tournera légèrement sur lui-même
   * avec les pièces"), portée par `OrbitControls` lui-même : `tick`
   * appelle déjà `controls.update()` à chaque frame, donc rien d'autre à
   * faire ici. */
  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
    // Nettement plus lent que le défaut de OrbitControls (2.0 ≈ un tour
    // en 30s à 60 IPS) — retour utilisateur direct : "le plateau tourne
    // beaucoup trop vite", alors qu'il ne doit que "tourner légèrement".
    this.controls.autoRotateSpeed = 0.4;
  }

  /** Affiche (ou met à jour) une pièce fantôme semi-transparente — la
   * pièce en cours de placement. `null` la masque. */
  setGhost(piece: Piece | null, valid: boolean = true): void {
    if (this.ghostMesh) {
      this.pieceGroup.remove(this.ghostMesh);
      this.disposePieceMesh(this.ghostMesh);
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
    this.disposePieceMesh(mesh);
    this.reflectionMeshes.delete(piece);
    if (this.removeHighlightMesh === mesh) {
      this.removeHighlightMesh = null;
      this.removeHighlightOriginalColor = null;
    }
  }

  clearReflectionPieces(): void {
    for (const mesh of this.reflectionMeshes.values()) this.disposePieceMesh(mesh);
    this.reflectionGroup.clear();
    this.reflectionMeshes.clear();
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;
  }

  /** Trace le chemin d'un rayon en tube lumineux, avec un point animé qui
   * parcourt le trajet et des anneaux à l'entrée/la sortie (style repris
   * de la maquette — remplace l'ancienne ligne fine). `entry` et les
   * positions de `steps` doivent être des coordonnées déjà CONTINUES
   * (voir `geometry.toContinuousCorner` pour convertir un point
   * d'entrée/sortie discret — ceux de `preview-engine.fireRayPreview` le
   * sont déjà). Mélanger discret et continu décale le tracé d'une
   * demi-case. */
  animateRay(entry: Point, steps: RayStep[], colorName: string): void {
    this.clearRay();
    const points = [entry, ...steps.map((s) => s.position)].map((p) => {
      const c = this.continuousToWorld(p);
      return new THREE.Vector3(c.x, RAY_HEIGHT, c.z);
    });
    if (points.length < 2) return;

    const color = new THREE.Color(RAY_COLOR_HEX[colorName] ?? 0x666666);

    const curvePath = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < points.length - 1; i++) curvePath.add(new THREE.LineCurve3(points[i]!, points[i + 1]!));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curvePath, Math.max(8, points.length * 8), 0.045, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    this.rayGroup.add(tube);

    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color }));
    this.rayGroup.add(dot);
    this.rayCurve = curvePath;
    this.rayDot = dot;
    this.rayT = 0;

    for (const p of [points[0]!, points[points.length - 1]!]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.3, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.16, p.z);
      this.rayGroup.add(ring);
    }
  }

  clearRay(): void {
    this.rayGroup.clear();
    this.rayCurve = null;
    this.rayDot = null;
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
    const hex = RAY_COLOR_HEX[colorName] ?? ENTRY_MARKER_DEFAULT_COLOR;
    // Fixe aussi la couleur "au repos" (voir `tick`) : sans ça,
    // l'animation de survol la ramènerait au gris neutre dès que la
    // souris quitte la borne.
    this.markerIdleColor.set(marker, hex);
    const material = (marker as THREE.Mesh).material as THREE.MeshStandardMaterial;
    material.color.setHex(hex);
  }

  /** Remet toutes les bornes à leur couleur neutre (ex : au début d'une
   * nouvelle partie sur la même scène). */
  clearMarkerColors(): void {
    for (const marker of this.entryTargets) {
      this.markerIdleColor.set(marker, ENTRY_MARKER_DEFAULT_COLOR);
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
      const material = this.removeHighlightMesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(this.removeHighlightOriginalColor);
    }
    this.removeHighlightMesh = null;
    this.removeHighlightOriginalColor = null;
    if (!piece) return;
    const mesh = this.pieceMeshes.get(piece) ?? this.reflectionMeshes.get(piece);
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    this.removeHighlightOriginalColor = material.color.getHex();
    material.color.lerp(new THREE.Color(0xe74c3c), 0.55);
    this.removeHighlightMesh = mesh;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationHandle);
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    // Voir `disposePieceMesh` : le reste de la scène (cases, socle,
    // bornes) est purement statique — construit une seule fois à la
    // création, jamais recréé — donc bien moins concerné par ce genre
    // de fuite ; les pièces, elles, sont reconstruites à chaque pose/
    // retrait pendant toute une session.
    for (const mesh of this.pieceMeshes.values()) this.disposePieceMesh(mesh);
    for (const mesh of this.reflectionMeshes.values()) this.disposePieceMesh(mesh);
    if (this.ghostMesh) this.disposePieceMesh(this.ghostMesh);
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
   * demi-case (bug corrigé une fois — voir docs/plan.md).
   *
   * Un point de BORD (entrée/sortie d'un rayon, ou une borne d'entrée —
   * voir `buildEntryMarkers`, qui passe aussi par ici) est en plus
   * "tiré" vers le plateau sur son seul axe hors limites (`ENTRY_TOUCH_OFFSET`
   * au lieu d'une case entière), pour toucher visiblement son bord
   * plutôt que de s'en trouver légèrement écarté (retour utilisateur
   * direct). Un point intérieur (rebond) n'est jamais concerné : ses
   * deux coordonnées restent dans les limites du plateau, donc aucune
   * des branches ci-dessous ne s'applique. */
  private continuousToWorld([x, z]: Point): THREE.Vector3 {
    const halfW = this.dimensions.width / 2;
    const halfH = this.dimensions.height / 2;
    let worldX = x - halfW;
    let worldZ = z - halfH;
    if (worldZ < -halfH) worldZ = -halfH - ENTRY_TOUCH_OFFSET;
    else if (worldZ > halfH) worldZ = halfH + ENTRY_TOUCH_OFFSET;
    else if (worldX < -halfW) worldX = -halfW - ENTRY_TOUCH_OFFSET;
    else if (worldX > halfW) worldX = halfW + ENTRY_TOUCH_OFFSET;
    return new THREE.Vector3(worldX, 0, worldZ);
  }

  /** Damier de cases pleines (au lieu d'un simple plan + grille de
   * lignes) : lueur émissive et léger soulèvement au survol, comme la
   * maquette. Chaque case garde sa surface supérieure à y=0 (`TILE_BASE_Y`
   * + moitié de la hauteur de la boîte), pour que les pièces posées
   * dessus restent alignées avec le reste du rendu (bornes, rayon...). */
  private buildGrid(): void {
    const { width, height } = this.dimensions;
    const halfW = width / 2;
    const halfH = height / 2;
    const tileGeometry = new THREE.BoxGeometry(0.94, 0.14, 0.94);

    this.buildBoardBody(width, height);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const dark = (col + row) % 2 === 0;
        const material = new THREE.MeshStandardMaterial({
          color: dark ? TILE_DARK : TILE_LIGHT,
          emissive: new THREE.Color(TILE_EMISSIVE_IDLE),
          emissiveIntensity: 0.5,
          roughness: 0.48,
          metalness: 0.3,
          flatShading: true,
        });
        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set(col - halfW + 0.5, TILE_BASE_Y, row - halfH + 0.5);
        tile.userData = { col, row };
        this.tiles.push(tile);
        this.scene.add(tile);
      }
    }
  }

  /** Corps épais du plateau sous les cases : une dalle sombre puis un
   * pied plus large et plus clair (comme un vrai plateau de jeu posé sur
   * un socle), plutôt qu'une grille plate sans épaisseur visible —
   * retour utilisateur direct. Purement décoratif (aucune interaction),
   * ajouté directement à `this.scene` une seule fois à la construction. */
  private buildBoardBody(width: number, height: number): void {
    // Les bornes d'entrée (1-18, A-R) sont centrées à 0,5 unité au-delà
    // du bord des cases (voir `cornerAverageWorld`/`buildEntryMarkers`)
    // et ont elles-mêmes jusqu'à 0,22 de rayon : il leur faut au moins
    // ~0,72 de débord pour reposer entièrement sur le support plutôt que
    // de dépasser dans le vide (retour utilisateur direct). Marge prise
    // largement pour qu'elles soient clairement "posées" dessus, pas
    // juste effleurées au bord.
    const slabTopY = TILE_BASE_Y - 0.07; // sous la face inférieure des cases
    const slabHeight = 0.5;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width + 1.8, slabHeight, height + 1.8),
      new THREE.MeshStandardMaterial({ color: 0x0a1230, roughness: 0.42, metalness: 0.35, flatShading: true }),
    );
    slab.position.set(0, slabTopY - slabHeight / 2, 0);
    this.scene.add(slab);

    const baseHeight = 0.34;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(width + 2.6, baseHeight, height + 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2c3a63, roughness: 0.46, metalness: 0.25, flatShading: true }),
    );
    base.position.set(0, slabTopY - slabHeight - baseHeight / 2, 0);
    this.scene.add(base);
  }

  private buildEntryMarkers(): void {
    for (const { label, entry } of this.labelScheme.allEntries()) {
      // `continuousToWorld` (pas `cornerAverageWorld`) : les bornes
      // d'entrée sont des points de BORD, tirés vers le plateau pour le
      // toucher (voir sa docstring / `ENTRY_TOUCH_OFFSET`) — contrairement
      // à une case ordinaire du plateau (`cornerAverageWorld`, ex.
      // `toggleMark`), qui garde son centrage habituel.
      const [col, row] = entry.position;
      const center = this.continuousToWorld([col + 0.5, row + 0.5]);

      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.22, 0.14, 6),
        new THREE.MeshStandardMaterial({
          color: ENTRY_MARKER_DEFAULT_COLOR,
          roughness: 0.35,
          metalness: 0.5,
          flatShading: true,
        }),
      );
      marker.position.set(center.x, ENTRY_BASE_Y, center.z);
      marker.userData.label = label;
      marker.userData.entry = entry;
      this.entryTargets.push(marker);
      this.markerIdleColor.set(marker, ENTRY_MARKER_DEFAULT_COLOR);
      this.scene.add(marker);

      // Or pour les numéros (bords haut/bas), cyan clair pour les
      // lettres (bords gauche/droit) — même convention que la maquette.
      const isNumeric = /\d/.test(label);
      const sprite = makeTextSprite(label, isNumeric ? "#f2c24b" : "#8fd0e8");
      sprite.position.set(center.x, 0.42, center.z);
      this.scene.add(sprite);
    }
  }

  private buildPieceMesh(piece: Piece, style: PieceMeshStyle): THREE.Mesh {
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

    // Biseau un peu plus marqué que la maquette, mais SANS excès : un
    // `bevelSize` trop grand par rapport aux petits segments des demi-
    // cases (la diagonale d'un triangle, par ex.) fait déraper l'offset
    // de biseau de Three.js sur les arêtes courtes/concaves — ça
    // produisait de vraies coutures en croix, couleur de la pièce, sous
    // chaque intersection de case (retour utilisateur direct : un essai
    // précédent, bien plus agressif, avait ce défaut). Ces valeurs
    // restent net plus marquées que l'aplat d'origine sans revenir à ce
    // bug.
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: GEM_HEIGHT,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.08,
      bevelSegments: 2,
    });

    const isDiamond = piece.kind === GemKind.DIAMOND;
    const isBlackBody = piece.kind === GemKind.BLACK_BODY;
    const color = isDiamond ? 0xbfe3f0 : isBlackBody ? 0x0b1330 : piece.color ? GEM_DISPLAY_COLOR[piece.color] : 0x999999;
    const transparent = isGhost || isReflection || isDiamond;
    const opacity = isGhost ? GHOST_OPACITY : isReflection ? REFLECTION_OPACITY : isDiamond ? 0.5 : 1;
    // `MeshPhysicalMaterial` (pas `MeshStandardMaterial`) : le vernis
    // ("clearcoat") ajoute un second reflet net par-dessus la couleur de
    // base, comme le poli d'une vraie gemme taillée — le corps noir
    // reste volontairement mat (aucun intérêt à briller). `metalness`
    // réduit (les gemmes ne sont pas des métaux) et une pointe de lueur
    // émissive de leur propre couleur : plus vif, plus visible sur le
    // plateau sombre (retour utilisateur direct — le rendu précédent
    // était trop terne).
    const material = new THREE.MeshPhysicalMaterial({
      color,
      roughness: isDiamond ? 0.05 : isBlackBody ? 0.65 : 0.12,
      metalness: isBlackBody ? 0.1 : 0.08,
      clearcoat: isBlackBody ? 0 : isDiamond ? 0.9 : 0.65,
      clearcoatRoughness: 0.12,
      emissive: isBlackBody ? 0x000000 : color,
      emissiveIntensity: isBlackBody ? 0 : isDiamond ? 0.08 : 0.22,
      flatShading: true,
      transparent,
      opacity,
    });
    if (isGhost) this.tintGhost(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /** Teinte le fantôme en vert/rouge selon la validité du placement
   * (retour utile, absent de la maquette qui n'a pas cette vérification
   * en direct) et lui ajoute une lueur émissive de cette même teinte,
   * pour le style "prospection" de la maquette. */
  private tintGhost(material: THREE.MeshStandardMaterial): void {
    const tint = new THREE.Color(this.ghostValid ? 0x2ecc71 : 0xe74c3c);
    material.color.lerp(tint, 0.45);
    material.emissive = tint;
    material.emissiveIntensity = 0.35;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownPosition = { x: event.clientX, y: event.clientY };
  };

  private handleClick = (event: MouseEvent): void => {
    const down = this.pointerDownPosition;
    this.pointerDownPosition = null;
    if (down) {
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      if (Math.hypot(dx, dy) > BoardScene.CLICK_DRAG_THRESHOLD_PX) return; // c'était une rotation, pas un clic
    }

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

    // Survol d'une borne d'entrée : mémorisé ici (pas recalculé chaque
    // frame) pour piloter son animation dans `tick`, sans re-raycaster
    // 60 fois par seconde.
    const entryHit = this.raycaster.intersectObjects(this.entryTargets, false)[0];
    this.hoveredEntryMesh = entryHit ? entryHit.object : null;
    this.hoveredTileCorner = this.hoveredEntryMesh ? null : this.cornerUnderPointer();
    this.onCornerHover?.(this.hoveredTileCorner);
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
    // Le plan mathématique est infini (voir docstring ci-dessus) : sans
    // cette vérification, cliquer n'importe où EN DEHORS du plateau
    // visible renvoyait quand même une case (col, row) hors limites —
    // un vrai bug, signalé par un retour utilisateur direct ("des cases
    // invisibles sont interrogeables").
    if (col < 0 || col >= this.dimensions.width || row < 0 || row >= this.dimensions.height) return null;
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
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.controls.update();

    for (const tile of this.tiles) {
      const { col, row } = tile.userData as { col: number; row: number };
      const isHovered = !!this.hoveredTileCorner && this.hoveredTileCorner[0] === col && this.hoveredTileCorner[1] === row;
      tile.position.y += ((isHovered ? TILE_HOVER_Y : TILE_BASE_Y) - tile.position.y) * HOVER_LERP_SPEED;
      const material = tile.material as THREE.MeshStandardMaterial;
      material.emissive.lerp(new THREE.Color(isHovered ? TILE_EMISSIVE_HOVER : TILE_EMISSIVE_IDLE), HOVER_LERP_SPEED);
      material.emissiveIntensity = isHovered ? 0.6 : 0.5;
    }

    for (const marker of this.entryTargets) {
      const isHovered = marker === this.hoveredEntryMesh;
      const idle = this.markerIdleColor.get(marker) ?? ENTRY_MARKER_DEFAULT_COLOR;
      marker.position.y += ((isHovered ? ENTRY_HOVER_Y : ENTRY_BASE_Y) - marker.position.y) * HOVER_LERP_SPEED;
      const material = (marker as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.color.lerp(new THREE.Color(isHovered ? ENTRY_MARKER_HOVER_COLOR : idle), HOVER_LERP_SPEED);
    }

    if (this.ghostMesh) {
      this.ghostMesh.position.y = Math.sin(this.timer.getElapsed() * 3) * 0.04;
    }

    if (this.rayDot && this.rayCurve) {
      this.rayT = (this.rayT + dt * 0.4) % 1;
      const p = this.rayCurve.getPoint(this.rayT);
      if (p) this.rayDot.position.copy(p);
    }

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

function makeTextSprite(text: string, color: string = "#f4ead6"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.font = "bold 40px 'Chakra Petch', system-ui, sans-serif";
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
