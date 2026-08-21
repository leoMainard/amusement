/**
 * Guide de jeu d'Orapa Mine : un tutoriel pas-à-pas sur un plateau 3D
 * réel (pas juste des images), qui se termine par la démo hors ligne
 * complète pour s'entraîner librement. Les scénarios utilisés
 * (positions, sens des rebonds) sont ceux vérifiés dans
 * `tests/engine/orapa_mine/test_raycast.py` côté backend — mêmes
 * chiffres, donc garantis cohérents avec le vrai moteur.
 *
 * En plus des pas illustrant les règles (plateau, pose, déviations),
 * trois pas couvrent les mécanismes du jeu réel absents d'une simple
 * lecture de règles : poser une question (rayon + interrogation de
 * case), prendre des notes, proposer une solution. Voir chacun des
 * `mount*Stage` ci-dessous.
 */

import { BoardScene } from "../../games/orapa-mine/board-scene";
import { colorBadgeHtml } from "../../games/orapa-mine/color-swatch";
import { mountOrapaMineDemo } from "../../games/orapa-mine/demo";
import { cellLabel, labelForExit } from "../../games/orapa-mine/entry-labels";
import { toContinuousCorner } from "../../games/orapa-mine/geometry";
import { PlacementController } from "../../games/orapa-mine/placement-controller";
import { fireRayPreview, peek, PreviewBoard, type RayResult } from "../../games/orapa-mine/preview-engine";
import { BASE_PIECE_PALETTE, Color, DEFAULT_DIMENSIONS, GemKind, type Piece, PieceShape } from "../../games/orapa-mine/types";

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

// Réutilisées par le pas « Proposer une solution » : les deux mêmes
// gemmes que le pas précédent (« Poser une question »), pour que la
// proposition se compare à un plateau que le joueur vient de voir.
const SOLUTION_PIECES: Piece[] = [YELLOW_TRIANGLE, WHITE_RHOMBUS];
const SOLUTION_PALETTE = [BASE_PIECE_PALETTE[1], BASE_PIECE_PALETTE[3]];

interface StepDef {
  title: string;
  body: string;
  /** Absent = pas « scénario » classique (plateau + tir optionnel). */
  kind?: "question" | "notes" | "solution" | "free";
  pieces: Piece[];
  fire?: { entry: [number, number]; direction: "UP" | "DOWN" | "LEFT" | "RIGHT"; explain: (r: RayResult) => string };
}

const STEPS: StepDef[] = [
  {
    title: "Le plateau",
    body: `
      <p>Le plateau est une grille de 9×9 cases. Tout autour, des bornes numérotées et
      lettrées permettent de tirer un rayon depuis n'importe quel bord.</p>
      <p>Fais tourner la vue avec la souris pour te repérer.</p>
    `,
    pieces: [],
  },
  {
    title: "Une gemme, posée",
    body: `
      <p>Voici le triangle rectangle jaune, posé sur le plateau. Chaque gemme est
      construite à partir de cases entières et de demi-cases (une case coupée en
      diagonale) — c'est cette diagonale qui va nous intéresser au prochain pas.</p>
    `,
    pieces: [YELLOW_TRIANGLE],
  },
  {
    title: "Le rayon dévie sur une diagonale",
    body: `
      <p>Clique « Lancer le rayon » : il entre par le bas, heurte le bord en diagonale de
      la gemme, et dévie de 90° au lieu de continuer tout droit.</p>
    `,
    pieces: [YELLOW_TRIANGLE],
    fire: {
      entry: [4, 9],
      direction: "UP",
      explain: (r) => `Le rayon entre par le bas, dévie sur la diagonale, et ressort en ${labelForExit(r.exit!, r.exitDirection!)} — couleur ${colorBadgeHtml(r.colorName)}.`,
    },
  },
  {
    title: "Le rayon rebondit sur un bord droit",
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
          ? `Le rayon ressort en ${labelForExit(r.exit, r.exitDirection!)} — exactement son point d'entrée. Couleur ${colorBadgeHtml(r.colorName)}.`
          : "Absorbé.",
    },
  },
  {
    title: "Les couleurs se mélangent",
    body: `
      <p>Avec deux gemmes sur son chemin, le rayon se teinte de chacune des couleurs
      touchées. Jaune + blanc donne ici « jaune clair ».</p>
    `,
    pieces: [YELLOW_TRIANGLE, WHITE_RHOMBUS],
    fire: {
      entry: [4, 9],
      direction: "UP",
      explain: (r) => `Le rayon touche le jaune puis le blanc, et ressort en ${labelForExit(r.exit!, r.exitDirection!)} — couleur ${colorBadgeHtml(r.colorName)}.`,
    },
  },
  {
    title: "Poser une question",
    body: `
      <p>En partie, tu ne vois pas les gemmes de l'adversaire — seulement leur effet sur
      les rayons. Ici, à titre d'exemple, elles restent visibles.</p>
      <p>Clique n'importe quelle borne du pourtour pour tirer un rayon librement.
      Active « ❓ Interroger une case » puis clique une case du plateau pour demander
      directement ce qu'elle contient (chaque case a un nom du type « E5 » — une lettre
      pour la colonne, un chiffre pour la ligne). Les deux questions coûtent un tour en
      vraie partie : à toi de choisir la plus utile.</p>
    `,
    kind: "question",
    pieces: [],
  },
  {
    title: "Prendre des notes",
    body: `
      <p>Recouper les rayons et les cases interrogées demande souvent de garder une trace
      écrite plutôt que de tout retenir de tête. En partie, un bloc-notes personnel
      (jamais transmis à l'adversaire) t'accompagne à tout moment — essaie-le ici (ce
      brouillon n'est pas sauvegardé) :</p>
    `,
    kind: "notes",
    pieces: [],
  },
  {
    title: "Proposer une solution",
    body: `
      <p>Quand tu penses savoir où se trouvent les gemmes, tu proposes une solution
      complète : une pièce par gemme, positionnée précisément. Retrouve ici les deux
      gemmes du pas « Poser une question » (triangle jaune + losange blanc) et pose-les
      au bon endroit avant de valider — en vraie partie, une proposition fausse ne met
      pas fin à la partie mais coûte un tour.</p>
    `,
    kind: "solution",
    pieces: [],
  },
  {
    title: "À toi de jouer",
    body: `
      <p>Pose tes propres gemmes et tire des rayons librement ci-dessous.</p>
      <p>Choisis une pièce dans la palette, oriente-la (pivoter/retourner — aussi possible
      au clavier, touches R et F), puis clique une case pour la poser. <strong>Recliquer une
      pièce déjà posée la retire</strong> : elle se teinte en rouge au survol pour te le
      rappeler.</p>
    `,
    kind: "free",
    pieces: [],
  },
];

export function mountOrapaMineGuide(root: HTMLElement): () => void {
  let stepIndex = 0;
  let scene: BoardScene | null = null;
  let disposeStage: (() => void) | null = null;

  render();

  function render(): void {
    const step = STEPS[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === STEPS.length - 1;

    root.innerHTML = `
      <div class="guide">
        <div class="guide__nav">
          <button type="button" class="guide__prev" ${isFirst ? "disabled" : ""}>← Précédent</button>
          <span class="guide__progress">${stepIndex + 1} / ${STEPS.length}</span>
          <button type="button" class="guide__next" ${isLast ? "disabled" : ""}>Suivant →</button>
        </div>
        <div class="guide__heading">
          <span class="guide__badge"><span>${stepIndex + 1}</span></span>
          <h3>${step.title}</h3>
        </div>
        ${step.body}
        <div class="guide__stage"></div>
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

    const stage = root.querySelector<HTMLDivElement>(".guide__stage")!;
    switch (step.kind) {
      case "free":
        disposeStage = mountOrapaMineDemo(stage);
        return;
      case "question":
        mountQuestionStage(stage);
        return;
      case "notes":
        mountNotesStage(stage);
        return;
      case "solution":
        mountSolutionStage(stage);
        return;
      default:
        mountScenarioStage(stage, step);
        return;
    }
  }

  function mountScenarioStage(stage: HTMLElement, step: StepDef): void {
    stage.innerHTML = `
      ${step.fire ? `<button type="button" class="guide__fire">Lancer le rayon</button><p class="guide__result" aria-live="polite"></p>` : ""}
      <div class="guide__canvas"></div>
    `;
    const canvasHost = stage.querySelector<HTMLDivElement>(".guide__canvas")!;
    scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
    const board = new PreviewBoard(DEFAULT_DIMENSIONS);
    for (const piece of step.pieces) board.placePiece(piece);
    scene.setPieces(board.pieces());

    if (step.fire) {
      const { entry, direction, explain } = step.fire;
      const resultHost = stage.querySelector<HTMLParagraphElement>(".guide__result")!;
      stage.querySelector<HTMLButtonElement>(".guide__fire")!.addEventListener("click", () => {
        const result = fireRayPreview(board, entry, direction);
        scene!.animateRay(toContinuousCorner(entry), result.path, result.colorName);
        resultHost.innerHTML = explain(result);
      });
    }
  }

  function mountQuestionStage(stage: HTMLElement): void {
    stage.innerHTML = `
      <div class="guide__canvas"></div>
      <div class="orapa-mp__ask-tools">
        <button type="button" class="orapa-mp__peek-toggle">❓ Interroger une case</button>
      </div>
      <div class="orapa-demo__result orapa-mp__log" aria-live="polite"></div>
    `;
    const canvasHost = stage.querySelector<HTMLDivElement>(".guide__canvas")!;
    scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
    const board = new PreviewBoard(DEFAULT_DIMENSIONS);
    board.placePiece(YELLOW_TRIANGLE);
    board.placePiece(WHITE_RHOMBUS);
    scene.setPieces(board.pieces());

    const logHost = stage.querySelector<HTMLDivElement>(".orapa-mp__log")!;
    const log: string[] = [];
    const pushLog = (line: string) => {
      log.push(line);
      if (log.length > 12) log.shift();
      logHost.innerHTML = log.map((l) => `<div>${l}</div>`).join("");
    };

    const peekToggle = stage.querySelector<HTMLButtonElement>(".orapa-mp__peek-toggle")!;
    let peekActive = false;
    peekToggle.addEventListener("click", () => {
      peekActive = !peekActive;
      peekToggle.classList.toggle("is-selected", peekActive);
    });

    scene.onCornerClick = ({ corner }) => {
      if (!peekActive) return;
      pushLog(`Qu'y a-t-il en ${cellLabel(corner)} ? ${peek(board, corner)}.`);
    };
    scene.onEntryClick = ({ label, entry }) => {
      const result = fireRayPreview(board, entry.position, entry.direction);
      scene!.animateRay(toContinuousCorner(entry.position), result.path, result.colorName);
      const exitLabel = result.exit && result.exitDirection ? labelForExit(result.exit, result.exitDirection) : "nulle part (absorbé)";
      pushLog(`Rayon depuis ${label} → sort en ${exitLabel}, couleur ${colorBadgeHtml(result.colorName)}.`);
    };
  }

  function mountNotesStage(stage: HTMLElement): void {
    stage.innerHTML = `
      <textarea
        class="orapa-mp__notepad guide__notes"
        placeholder="Ex : rayon depuis A3 → sort en 7, jaune clair. Donc du jaune ET du blanc sur ce trajet..."
      ></textarea>
    `;
  }

  function mountSolutionStage(stage: HTMLElement): void {
    stage.innerHTML = `
      <div class="guide__canvas"></div>
      <div class="orapa-demo__panel">
        <div class="orapa-place__preview">
          <span class="om-eyebrow">Aperçu</span>
        </div>
        <div class="orapa-place__preview-box"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter 90°</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
        </div>
        <span class="om-eyebrow">Ta proposition</span>
        <div class="orapa-demo__palette"></div>
        <div class="orapa-demo__bulk-actions">
          <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
          <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
        </div>
        <button type="button" class="orapa-demo__validate" disabled>Proposer cette solution (0/2)</button>
        <div class="orapa-demo__result" aria-live="polite"></div>
      </div>
    `;
    const canvasHost = stage.querySelector<HTMLDivElement>(".guide__canvas")!;
    scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
    const paletteHost = stage.querySelector<HTMLDivElement>(".orapa-demo__palette")!;
    const previewHost = stage.querySelector<HTMLDivElement>(".orapa-place__preview-box")!;
    const rotateButton = stage.querySelector<HTMLButtonElement>(".orapa-demo__rotate")!;
    const mirrorButton = stage.querySelector<HTMLButtonElement>(".orapa-demo__mirror")!;
    const clearButton = stage.querySelector<HTMLButtonElement>(".orapa-demo__bulk-clear")!;
    const randomButton = stage.querySelector<HTMLButtonElement>(".orapa-demo__bulk-random")!;
    const validateButton = stage.querySelector<HTMLButtonElement>(".orapa-demo__validate")!;
    const resultHost = stage.querySelector<HTMLDivElement>(".orapa-demo__result")!;

    // Un plateau de référence purement géométrique (jamais posé nulle
    // part) sert juste à calculer les cases couvertes par chaque pièce,
    // pour comparer la proposition à la vraie solution sans dépendre de
    // l'ordre ou de la rotation/miroir exacts utilisés pour la poser.
    const referenceBoard = new PreviewBoard(DEFAULT_DIMENSIONS);
    const solutionQuadrants = SOLUTION_PIECES.map((piece) => referenceBoard.quadrants(piece));

    const controller = new PlacementController({
      scene,
      paletteHost,
      previewHost,
      rotateButton,
      mirrorButton,
      validateButton,
      clearButton,
      randomButton,
      validateLabel: "Proposer cette solution",
      statusHost: resultHost,
      pieces: SOLUTION_PALETTE,
      onValidate: (guessPieces) => {
        let matched = 0;
        const used = new Set<number>();
        for (const piece of guessPieces) {
          const guessKeys = referenceBoard.quadrants(piece);
          const idx = solutionQuadrants.findIndex((keys, i) => !used.has(i) && sameQuadrants(keys, guessKeys));
          if (idx !== -1) {
            matched++;
            used.add(idx);
          }
        }
        resultHost.textContent =
          matched === SOLUTION_PIECES.length
            ? "✅ Exactement ça ! Voici le plateau réel, pour comparer :"
            : `🟡 ${matched}/${SOLUTION_PIECES.length} gemme(s) bien placée(s). Voici le plateau réel, pour comparer :`;
        // Illustratif seulement : en vraie partie, cette comparaison est
        // faite côté serveur par `check_solution` (amusement.engine),
        // jamais dans le navigateur.
        scene!.setPieces(SOLUTION_PIECES);
      },
    });
    disposeStage = () => controller.dispose();
  }

  function sameQuadrants(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
  }

  function teardownStepResources(): void {
    scene?.dispose();
    scene = null;
    disposeStage?.();
    disposeStage = null;
  }

  return () => {
    teardownStepResources();
  };
}
