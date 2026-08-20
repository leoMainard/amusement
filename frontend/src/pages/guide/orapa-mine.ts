/**
 * Guide de jeu d'Orapa Mine : un tutoriel pas-à-pas sur un plateau 3D
 * réel (pas juste des images), qui se termine par la démo hors ligne
 * complète pour s'entraîner librement. Les scénarios utilisés
 * (positions, sens des rebonds) sont ceux vérifiés dans
 * `tests/engine/orapa_mine/test_raycast.py` côté backend — mêmes
 * chiffres, donc garantis cohérents avec le vrai moteur.
 */

import { BoardScene } from "../../games/orapa-mine/board-scene";
import { mountOrapaMineDemo } from "../../games/orapa-mine/demo";
import { fireRayPreview, PreviewBoard, type RayResult } from "../../games/orapa-mine/preview-engine";
import { Color, DEFAULT_DIMENSIONS, GemKind, type Piece, PieceShape } from "../../games/orapa-mine/types";

const YELLOW_TRIANGLE: Piece = {
  shape: PieceShape.MEDIUM_TRIANGLE,
  kind: GemKind.NORMAL,
  color: Color.YELLOW,
  origin: [3, 3],
  rotationSteps: 0,
  mirrored: false,
};
const WHITE_RHOMBUS: Piece = {
  shape: PieceShape.RHOMBUS,
  kind: GemKind.NORMAL,
  color: Color.WHITE,
  origin: [6, 2],
  rotationSteps: 0,
  mirrored: false,
};

interface StepDef {
  title: string;
  body: string;
  pieces: Piece[];
  fire?: { entry: [number, number]; direction: "UP" | "DOWN" | "LEFT" | "RIGHT"; explain: (r: RayResult) => string };
}

const STEPS: StepDef[] = [
  {
    title: "1. Le plateau",
    body: `
      <p>Le plateau est une grille de 9×9 cases. Tout autour, des bornes numérotées et
      lettrées permettent de tirer un rayon depuis n'importe quel bord.</p>
      <p>Fais tourner la vue avec la souris pour te repérer.</p>
    `,
    pieces: [],
  },
  {
    title: "2. Une gemme, posée",
    body: `
      <p>Voici le triangle rectangle jaune, posé sur le plateau. Chaque gemme est
      construite à partir de cases entières et de demi-cases (une case coupée en
      diagonale) — c'est cette diagonale qui va nous intéresser au prochain pas.</p>
    `,
    pieces: [YELLOW_TRIANGLE],
  },
  {
    title: "3. Le rayon dévie sur une diagonale",
    body: `
      <p>Clique « Lancer le rayon » : il entre par le bas, heurte le bord en diagonale de
      la gemme, et dévie de 90° au lieu de continuer tout droit.</p>
    `,
    pieces: [YELLOW_TRIANGLE],
    fire: {
      entry: [4, 9],
      direction: "UP",
      explain: (r) => `Le rayon entre par le bas, dévie sur la diagonale, et ressort en (${r.exit![0]}, ${r.exit![1]}) — couleur ${r.colorName}.`,
    },
  },
  {
    title: "4. Le rayon rebondit sur un bord droit",
    body: `
      <p>Cette fois le rayon arrive de face sur un bord <strong>droit</strong> de la même
      gemme (pas une diagonale) : il rebondit à 180° et ressort... par son propre point
      d'entrée. C'est le même mécanisme que dans le jeu classique <em>Black Box</em>, dont
      Orapa Mine s'inspire.</p>
    `,
    pieces: [YELLOW_TRIANGLE],
    fire: {
      entry: [-1, 4],
      direction: "RIGHT",
      explain: (r) =>
        r.exit
          ? `Le rayon ressort en (${r.exit[0]}, ${r.exit[1]}) — exactement son point d'entrée. Couleur ${r.colorName}.`
          : "Absorbé.",
    },
  },
  {
    title: "5. Les couleurs se mélangent",
    body: `
      <p>Avec deux gemmes sur son chemin, le rayon se teinte de chacune des couleurs
      touchées. Jaune + blanc donne ici « jaune clair ».</p>
    `,
    pieces: [YELLOW_TRIANGLE, WHITE_RHOMBUS],
    fire: {
      entry: [4, 9],
      direction: "UP",
      explain: (r) => `Le rayon touche le jaune puis le blanc, et ressort en (${r.exit![0]}, ${r.exit![1]}) — couleur ${r.colorName}.`,
    },
  },
  {
    title: "6. À toi de jouer",
    body: `<p>Pose tes propres gemmes et tire des rayons librement ci-dessous.</p>`,
    pieces: [],
  },
];

export function mountOrapaMineGuide(root: HTMLElement): () => void {
  let stepIndex = 0;
  let scene: BoardScene | null = null;
  let disposeDemo: (() => void) | null = null;

  render();

  function render(): void {
    const step = STEPS[stepIndex];
    const isLastStep = stepIndex === STEPS.length - 1;

    root.innerHTML = `
      <div class="guide">
        <div class="guide__nav">
          <button type="button" class="guide__prev" ${stepIndex === 0 ? "disabled" : ""}>← Précédent</button>
          <span class="guide__progress">${stepIndex + 1} / ${STEPS.length}</span>
          <button type="button" class="guide__next" ${isLastStep ? "disabled" : ""}>Suivant →</button>
        </div>
        <h3>${step.title}</h3>
        ${step.body}
        ${step.fire ? `<button type="button" class="guide__fire">Lancer le rayon</button><p class="guide__result" aria-live="polite"></p>` : ""}
        <div class="guide__canvas ${isLastStep ? "hidden" : ""}"></div>
        <div class="guide__demo-root ${isLastStep ? "" : "hidden"}"></div>
      </div>
    `;

    root.querySelector<HTMLButtonElement>(".guide__prev")?.addEventListener("click", () => {
      stepIndex = Math.max(0, stepIndex - 1);
      teardownStepResources();
      render();
    });
    root.querySelector<HTMLButtonElement>(".guide__next")?.addEventListener("click", () => {
      stepIndex = Math.min(STEPS.length - 1, stepIndex + 1);
      teardownStepResources();
      render();
    });

    if (isLastStep) {
      const demoRoot = root.querySelector<HTMLDivElement>(".guide__demo-root")!;
      disposeDemo = mountOrapaMineDemo(demoRoot);
      return;
    }

    const canvasHost = root.querySelector<HTMLDivElement>(".guide__canvas")!;
    scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
    const board = new PreviewBoard(DEFAULT_DIMENSIONS);
    for (const piece of step.pieces) board.placePiece(piece);
    scene.setPieces(board.pieces());

    if (step.fire) {
      const { entry, direction, explain } = step.fire;
      const resultHost = root.querySelector<HTMLParagraphElement>(".guide__result")!;
      root.querySelector<HTMLButtonElement>(".guide__fire")!.addEventListener("click", () => {
        const result = fireRayPreview(board, entry, direction);
        scene!.animateRay(entry, result.path, result.colorName);
        resultHost.textContent = explain(result);
      });
    }
  }

  function teardownStepResources(): void {
    scene?.dispose();
    scene = null;
    disposeDemo?.();
    disposeDemo = null;
  }

  return () => {
    teardownStepResources();
  };
}
