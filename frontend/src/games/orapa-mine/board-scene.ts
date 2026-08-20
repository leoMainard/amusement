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
const RAY_HEIGHT = 0.32;

const RAY_COLOR_HEX: Record<string, number> = {
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
  absorbé: 0x1a1a1a,
};

export interface CornerClickEvent {
  corner: Position;
}

export interface PieceClickEvent {
  piece: Piece;
}

export interface EntryClickEvent {
  label: string;
  entry: Entry;
}

export class BoardScene {
  readonly dimensions: BoardDimensions;

  onCornerClick: ((event: CornerClickEvent) => void) | null = null;
  onPieceClick: ((event: PieceClickEvent) => void) | null = null;
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
  private groundPlane: THREE.Mesh;

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

    this.groundPlane = this.buildGrid();
    this.buildEntryMarkers();
    this.scene.add(this.pieceGroup);
    this.scene.add(this.rayGroup);

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

    for (const piece of pieces) {
      const mesh = this.buildPieceMesh(piece, false);
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
    this.ghostMesh = this.buildPieceMesh(piece, true);
    this.pieceGroup.add(this.ghostMesh);
  }

  /** Trace le chemin d'un rayon (bord d'entrée -> étapes de `preview-engine.fireRayPreview`). */
  animateRay(entry: Position, steps: RayStep[], colorName: string): void {
    this.rayGroup.clear();
    const points = [entry as Point, ...steps.map((s) => s.position)].map((p) => {
      const c = this.cornerAverageWorld(p);
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

  dispose(): void {
    cancelAnimationFrame(this.animationHandle);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** (col, row) de grille -> position monde sur le sol (y=0). Accepte
   * aussi des coordonnées fractionnaires (points intermédiaires du
   * tracé d'un rayon, ou centre d'une case pour les bornes d'entrée). */
  private cornerAverageWorld([col, row]: Point): THREE.Vector3 {
    const x = col - this.dimensions.width / 2 + 0.5;
    const z = row - this.dimensions.height / 2 + 0.5;
    return new THREE.Vector3(x, 0, z);
  }

  private buildGrid(): THREE.Mesh {
    const { width, height } = this.dimensions;
    const halfW = width / 2;
    const halfH = height / 2;

    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ color: 0xe4e4e8, roughness: 0.9 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.userData.isGround = true;
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

    return base;
  }

  private buildEntryMarkers(): void {
    for (const { label, entry } of this.labelScheme.allEntries()) {
      const center = this.cornerAverageWorld(entry.position);

      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: 0x6b7280 }),
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

  private buildPieceMesh(piece: Piece, isGhost: boolean): THREE.Object3D {
    if (piece.kind === GemKind.BLACK_BODY || piece.kind === GemKind.DIAMOND) {
      const isDiamond = piece.kind === GemKind.DIAMOND;
      const color = isDiamond ? 0xbfe3f0 : 0x1a1a1a;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, GEM_HEIGHT, 4),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          transparent: isGhost || isDiamond,
          opacity: isGhost ? GHOST_OPACITY : isDiamond ? 0.45 : 1,
        }),
      );
      mesh.rotation.y = Math.PI / 4;
      const center = this.cornerAverageWorld(piece.origin);
      mesh.position.set(center.x, GEM_HEIGHT / 2, center.z);
      if (isGhost) this.tintGhost(mesh.material as THREE.MeshStandardMaterial);
      return mesh;
    }

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
    const color = piece.color ? GEM_DISPLAY_COLOR[piece.color] : 0x999999;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      transparent: isGhost,
      opacity: isGhost ? GHOST_OPACITY : 1,
    });
    if (isGhost) this.tintGhost(material);
    const mesh = new THREE.Mesh(geometry, material);
    // Contour sombre : sans lui, une pièce blanche se distingue mal du
    // sol clair du plateau (retour utilisateur direct sur ce point).
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 20),
      new THREE.LineBasicMaterial({ color: 0x3a3a38, transparent: isGhost, opacity: isGhost ? GHOST_OPACITY : 1 }),
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

    const pieceHit = this.raycaster.intersectObjects([...this.pieceMeshes.values()], false)[0];
    if (pieceHit) {
      const piece = pieceHit.object.userData.piece as Piece;
      this.onPieceClick?.({ piece });
      return;
    }

    const groundHit = this.raycaster.intersectObject(this.groundPlane, false)[0];
    if (groundHit) {
      this.onCornerClick?.({ corner: this.nearestCorner(groundHit.point) });
    }
  };

  private handlePointerMove = (event: MouseEvent): void => {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.groundPlane, false)[0];
    if (hit) {
      this.onCornerHover?.(this.nearestCorner(hit.point));
    } else {
      this.onCornerHover?.(null);
    }
  };

  private nearestCorner(point: THREE.Vector3): Position {
    const col = Math.round(point.x + this.dimensions.width / 2);
    const row = Math.round(point.z + this.dimensions.height / 2);
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
