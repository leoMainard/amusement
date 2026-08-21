/**
 * Écran multijoueur Orapa Mine : créer/rejoindre un salon par lien,
 * lobby, placement (Duel — le vrai paravent est le serveur, qui ne
 * renvoie jamais le plateau adverse en clair), puis prospection
 * (questions + proposition de solution).
 *
 * ⚠️ Contrairement à la démo hors ligne (`demo.ts`), ce module ne
 * contient AUCUNE logique de jeu : chaque action passe par le serveur
 * (`protocol.ts`), qui reste seul juge de ce qui est valide. Le serveur
 * ne renvoie que l'entrée et la sortie d'un rayon (pas les rebonds
 * intermédiaires) : exposer ces points donnerait plus d'information que
 * le jeu physique n'en donne jamais à un vrai prospecteur.
 *
 * Un résultat de rayon ne trace pas de ligne (elle disparaîtrait au tir
 * suivant, compliquant la résolution — retour utilisateur direct) : les
 * bornes d'entrée et de sortie sont plutôt colorées durablement selon la
 * couleur obtenue (`BoardScene.colorEntryMarker`). Pour un plateau fixe,
 * une borne donnée ne peut produire qu'une seule couleur, donc ça
 * construit naturellement une carte de toutes les questions posées.
 */

import { BoardScene } from "./board-scene";
import { colorBadgeHtml } from "./color-swatch";
import { cellLabel, labelForExit } from "./entry-labels";
import { PlacementController } from "./placement-controller";
import { ReflectionController, type ReflectionPaletteEntry } from "./reflection-controller";
import {
  type GameStatePayload,
  type RayResultPayload,
  type RoomMode,
  type RoomPayload,
  createRoom,
  sendAskPeek,
  sendAskRay,
  sendSubmitSolution,
  sendValidatePlacement,
  sendRemovePiece,
  sendPlacePiece,
} from "./protocol";
import { WS_BASE_URL } from "../../lib/config";
import { RoomSocket } from "../../lib/room-socket";
import { BASE_PIECE_PALETTE, DEFAULT_DIMENSIONS, EXTENSION_PIECE_PALETTE, REFLECTION_UNIT_PALETTE, type Position } from "./types";

const MODE_LABELS: Record<RoomMode, string> = {
  DUEL: "Duel (1 contre 1, règles officielles)",
  FOUILLE: "Fouille (plateau généré aléatoirement, tour par tour) — seul ou à plusieurs",
};

/** Palette du panneau de réflexion : les 5 pièces complètes, les
 * extensions si le salon les autorise, et les repères élémentaires
 * (case/demi-case colorée) — voir `reflection-controller.ts`. */
function reflectionEntries(extensionsEnabled: boolean): ReflectionPaletteEntry[] {
  return [...BASE_PIECE_PALETTE, ...(extensionsEnabled ? EXTENSION_PIECE_PALETTE : []), ...REFLECTION_UNIT_PALETTE];
}

export function mountOrapaMineMultiplayer(root: HTMLElement): () => void {
  let socket: RoomSocket | null = null;
  let scene: BoardScene | null = null;
  let placementController: PlacementController | null = null;
  let guessController: PlacementController | null = null;
  let reflectionController: ReflectionController | null = null;
  let playerId = "";
  let room: RoomPayload | null = null;
  let mode: "ask" | "guess" = "ask";
  let lastGameState: GameStatePayload | null = null;
  const log: string[] = [];

  render();

  function render(): void {
    root.innerHTML = `<div class="orapa-mp"></div>`;
    const host = root.querySelector<HTMLDivElement>(".orapa-mp")!;
    if (!room) {
      renderSetup(host);
    } else if (room.status === "LOBBY") {
      renderLobby(host);
    } else {
      renderGame(host);
    }
  }

  // --- Écran 1 : créer ou rejoindre --------------------------------------

  function renderSetup(host: HTMLElement): void {
    const prefillCode = new URLSearchParams(location.search).get("room") ?? "";
    host.innerHTML = `
      <div class="orapa-mp__setup">
        <section class="orapa-mp__panel">
          <h3>Créer une partie</h3>
          <label>Ton nom <input type="text" class="orapa-mp__create-name" value="Joueur 1" /></label>
          <label>Mode
            <select class="orapa-mp__mode">
              <option value="DUEL">${MODE_LABELS.DUEL}</option>
              <option value="FOUILLE">${MODE_LABELS.FOUILLE}</option>
            </select>
          </label>
          <label class="orapa-mp__max-players">Nombre de joueurs
            <input type="number" class="orapa-mp__max-players-input" min="2" max="8" value="2" disabled />
          </label>
          <p class="orapa-mp__max-players-hint" hidden>Mets 1 pour jouer seul.</p>
          <label class="orapa-mp__extensions">
            <input type="checkbox" class="orapa-mp__extensions-input" />
            Autoriser les pièces d'extension (Diamant, Corps noir)
          </label>
          <p class="orapa-mp__extensions-hint">
            Fixé pour tout le salon : les deux joueurs auront (ou non) accès à ces pièces en plus des 5 de base.
          </p>
          <button type="button" class="orapa-mp__create-btn">Créer et rejoindre</button>
        </section>
        <section class="orapa-mp__panel">
          <h3>Rejoindre une partie</h3>
          <label>Ton nom <input type="text" class="orapa-mp__join-name" value="Joueur 2" /></label>
          <label>Code du salon <input type="text" class="orapa-mp__join-code" value="${prefillCode}" maxlength="5" /></label>
          <button type="button" class="orapa-mp__join-btn">Rejoindre</button>
        </section>
        <p class="orapa-mp__error" aria-live="polite"></p>
      </div>
    `;

    const modeSelect = host.querySelector<HTMLSelectElement>(".orapa-mp__mode")!;
    const maxPlayersInput = host.querySelector<HTMLInputElement>(".orapa-mp__max-players-input")!;
    const maxPlayersHint = host.querySelector<HTMLParagraphElement>(".orapa-mp__max-players-hint")!;
    modeSelect.addEventListener("change", () => {
      const isDuel = modeSelect.value === "DUEL";
      maxPlayersInput.disabled = isDuel;
      maxPlayersInput.min = isDuel ? "2" : "1";
      maxPlayersInput.value = "2";
      maxPlayersHint.hidden = isDuel;
    });

    const errorHost = host.querySelector<HTMLParagraphElement>(".orapa-mp__error")!;

    const extensionsInput = host.querySelector<HTMLInputElement>(".orapa-mp__extensions-input")!;

    host.querySelector<HTMLButtonElement>(".orapa-mp__create-btn")!.addEventListener("click", async () => {
      errorHost.textContent = "";
      const name = host.querySelector<HTMLInputElement>(".orapa-mp__create-name")!.value.trim() || "Joueur";
      const roomMode = modeSelect.value as RoomMode;
      const maxPlayers = Number(maxPlayersInput.value) || 2;
      try {
        const created = await createRoom(roomMode, maxPlayers, extensionsInput.checked);
        await connect(created.code, name);
      } catch (error) {
        errorHost.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    host.querySelector<HTMLButtonElement>(".orapa-mp__join-btn")!.addEventListener("click", async () => {
      errorHost.textContent = "";
      const name = host.querySelector<HTMLInputElement>(".orapa-mp__join-name")!.value.trim() || "Joueur";
      const code = host.querySelector<HTMLInputElement>(".orapa-mp__join-code")!.value.trim();
      if (!code) {
        errorHost.textContent = "Indique un code de salon.";
        return;
      }
      try {
        await connect(code, name);
      } catch (error) {
        errorHost.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }

  async function connect(code: string, name: string): Promise<void> {
    const ws = new RoomSocket(`${WS_BASE_URL}/ws/rooms/${code}?name=${encodeURIComponent(name)}`);
    await ws.ready();
    socket = ws;
    wireSocket(ws);
  }

  // --- Écran 2 : lobby -----------------------------------------------------

  function renderLobby(host: HTMLElement): void {
    if (!room) return;
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    host.innerHTML = `
      <div class="orapa-mp__lobby">
        <h3>Salon ${room.code}</h3>
        <p class="orapa-mp__mode-label">${MODE_LABELS[room.mode]}</p>
        <p class="orapa-mp__extensions-label">
          ${room.extensions_enabled ? "Extensions activées (Diamant, Corps noir)" : "Extensions désactivées (5 gemmes de base uniquement)"}
        </p>
        <div class="orapa-mp__share">
          <input type="text" readonly class="orapa-mp__link" value="${link}" />
          <button type="button" class="orapa-mp__copy">Copier le lien</button>
        </div>
        <ul class="orapa-mp__players">
          ${room.players.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}
        </ul>
        <p>${room.players.length}/${room.max_players} joueurs — en attente...</p>
      </div>
    `;
    const copyButton = host.querySelector<HTMLButtonElement>(".orapa-mp__copy")!;
    const linkInput = host.querySelector<HTMLInputElement>(".orapa-mp__link")!;
    const originalCopyLabel = copyButton.textContent ?? "Copier le lien";

    copyButton.addEventListener("click", async () => {
      const copied = await copyToClipboard(link, linkInput);
      copyButton.textContent = copied ? "Copié !" : "Sélectionné — Ctrl+C pour copier";
      setTimeout(() => {
        copyButton.textContent = originalCopyLabel;
      }, 2000);
    });
  }

  // --- Écran 3 : la partie (placement puis prospection) --------------------

  function renderGame(host: HTMLElement): void {
    if (!room) return;
    host.innerHTML = `
      <div class="orapa-demo">
        <div class="orapa-demo__canvas"></div>
        <aside class="orapa-demo__panel">
          <h3>Salon ${room.code} — ${MODE_LABELS[room.mode]}</h3>
          <div class="orapa-mp__phase"></div>
          <div class="orapa-mp__game-controls"></div>
          <div class="orapa-demo__result orapa-mp__log" aria-live="polite"></div>
          <details class="orapa-mp__notepad-block">
            <summary>Bloc-notes (personnel, non partagé)</summary>
            <textarea class="orapa-mp__notepad" placeholder="Note ce que tu veux ici — déductions, cases à retenir..."></textarea>
          </details>
        </aside>
      </div>
    `;
    const canvasHost = host.querySelector<HTMLDivElement>(".orapa-demo__canvas")!;
    if (!scene) {
      scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
    } else {
      // Le conteneur a été recréé dans le DOM (nouvel écran) : la scène
      // garde son état interne, seul son <canvas> doit être ré-attaché.
      scene.attachTo(canvasHost);
    }

    const phaseHost = host.querySelector<HTMLDivElement>(".orapa-mp__phase")!;
    const controlsHost = host.querySelector<HTMLDivElement>(".orapa-mp__game-controls")!;
    const logHost = host.querySelector<HTMLDivElement>(".orapa-mp__log")!;
    logHost.innerHTML = log.map((line) => `<div>${line}</div>`).join("");
    setUpNotepad(host.querySelector<HTMLTextAreaElement>(".orapa-mp__notepad")!);

    if (room.status === "PLACING") {
      renderPlacing(phaseHost, controlsHost);
    } else if (room.status === "PLAYING") {
      renderPlaying(phaseHost, controlsHost);
    } else if (room.status === "FINISHED") {
      renderFinished(phaseHost);
      scene.setGhost(null);
    }
  }

  // --- Bloc-notes personnel -------------------------------------------------
  // Purement local (localStorage, par salon) : jamais transmis au serveur
  // ni à l'adversaire — sert juste à noter librement pendant la partie.

  function notepadStorageKey(): string {
    return `orapa-mine-notes-${room?.code ?? ""}`;
  }

  function setUpNotepad(textarea: HTMLTextAreaElement): void {
    textarea.value = localStorage.getItem(notepadStorageKey()) ?? "";
    textarea.addEventListener("input", () => {
      localStorage.setItem(notepadStorageKey(), textarea.value);
    });
  }

  function renderPlacing(phaseHost: HTMLElement, controlsHost: HTMLElement): void {
    phaseHost.innerHTML = `<p>Place tes 5 gemmes sur <strong>ton</strong> plateau, à l'abri des regards.</p>`;
    controlsHost.innerHTML = `
      <p class="orapa-demo__hint">
        Choisis une pièce, oriente-la (touches <kbd>R</kbd> pivoter / <kbd>F</kbd> retourner, en
        plus des boutons), puis clique une case pour la poser. Reclique une pièce déjà posée —
        elle se teinte en rouge au survol — pour la retirer.
      </p>
      <div class="orapa-place__preview">
        <span class="om-eyebrow">Aperçu</span>
      </div>
      <div class="orapa-place__preview-box"></div>
      <div class="orapa-demo__transform">
        <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
        <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
      </div>
      <span class="om-eyebrow">Vos gemmes</span>
      <div class="orapa-demo__palette"></div>
      <div class="orapa-demo__bulk-actions">
        <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
        <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
      </div>
      <button type="button" class="orapa-demo__validate" disabled>Valider le placement (0/5)</button>
      <p class="orapa-demo__result orapa-mp__placement-status" aria-live="polite"></p>
      <p class="orapa-mp__wait"></p>
    `;
    if (!scene) return;
    placementController?.dispose();
    placementController = new PlacementController({
      scene,
      paletteHost: controlsHost.querySelector(".orapa-demo__palette")!,
      previewHost: controlsHost.querySelector(".orapa-place__preview-box")!,
      rotateButton: controlsHost.querySelector(".orapa-demo__rotate")!,
      mirrorButton: controlsHost.querySelector(".orapa-demo__mirror")!,
      validateButton: controlsHost.querySelector(".orapa-demo__validate")!,
      clearButton: controlsHost.querySelector(".orapa-demo__bulk-clear")!,
      randomButton: controlsHost.querySelector(".orapa-demo__bulk-random")!,
      statusHost: controlsHost.querySelector(".orapa-mp__placement-status")!,
      extensionPieces: room!.extensions_enabled ? EXTENSION_PIECE_PALETTE : undefined,
      onPlace: (piece) => sendPlacePiece(socket!, piece),
      onRemove: (piece) => sendRemovePiece(socket!, piece.origin),
      onValidate: () => {
        sendValidatePlacement(socket!);
        controlsHost.querySelector(".orapa-mp__wait")!.textContent = "En attente de l'adversaire...";
      },
    });
  }

  function isMyTurn(): boolean {
    if (!room) return false;
    const state = lastGameState;
    if (!state) return false;
    const turnPlayer = room.mode === "DUEL" ? state.current_prospector : state.current_turn_player;
    return turnPlayer === playerId;
  }

  function renderPlaying(phaseHost: HTMLElement, controlsHost: HTMLElement): void {
    phaseHost.innerHTML = `<p class="orapa-mp__turn"></p>`;
    controlsHost.innerHTML = `
      <div class="orapa-mp__mode-toggle">
        <button type="button" class="orapa-mp__ask-btn">Poser une question</button>
        <button type="button" class="orapa-mp__guess-btn">Proposer une solution</button>
      </div>
      <div class="orapa-mp__ask-panel">
        <p class="orapa-demo__hint">
          Clique une borne du pourtour pour tirer un rayon. Les bornes d'entrée et de sortie se
          colorent durablement selon le résultat — une carte de tes questions posées s'accumule au
          fil de la partie.
        </p>
        <div class="orapa-mp__ask-tools">
          <button type="button" class="orapa-mp__peek-toggle">❓ Demander une case</button>
          <button type="button" class="orapa-mp__mark-toggle">✕ Marquer des cases</button>
          <button type="button" class="orapa-mp__reflect-toggle">🧩 Placer des repères</button>
        </div>
        <p class="orapa-demo__hint orapa-mp__peek-hint" hidden>
          Clique une case pour demander ce qu'elle contient. Reclique ce bouton pour arrêter.
        </p>
        <p class="orapa-demo__hint orapa-mp__mark-hint" hidden>
          Clique une case pour y poser (ou enlever) une croix — usage personnel, jamais transmis
          à l'adversaire. Reclique ce bouton pour arrêter de marquer.
        </p>
        <div class="orapa-mp__reflect-panel" hidden>
          <p class="orapa-demo__hint">
            Pose une gemme entière ou juste un repère (case ou demi-case colorée) comme hypothèse
            personnelle — visible pendant que tu poses des questions, jamais transmis à
            l'adversaire. Reclique une pièce posée (elle se teinte en rouge au survol) pour la
            retirer.
          </p>
          <div class="orapa-demo__palette orapa-mp__reflect-palette"></div>
          <div class="orapa-demo__transform">
            <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
            <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
          </div>
          <button type="button" class="orapa-mp__reflect-clear">Vider mes repères</button>
          <p class="orapa-demo__result orapa-mp__reflect-status" aria-live="polite"></p>
        </div>
      </div>
      <div class="orapa-mp__guess-panel" hidden>
        <div class="orapa-place__preview">
          <span class="om-eyebrow">Aperçu</span>
        </div>
        <div class="orapa-place__preview-box"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
        </div>
        <span class="om-eyebrow">Ta proposition</span>
        <div class="orapa-demo__palette"></div>
        <div class="orapa-demo__bulk-actions">
          <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
          <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
        </div>
        <button type="button" class="orapa-demo__validate" disabled>Proposer cette solution (0/5)</button>
        <p class="orapa-demo__result orapa-mp__guess-status" aria-live="polite"></p>
      </div>
    `;

    const askBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__ask-btn")!;
    const guessBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__guess-btn")!;
    const askPanel = controlsHost.querySelector<HTMLDivElement>(".orapa-mp__ask-panel")!;
    const guessPanel = controlsHost.querySelector<HTMLDivElement>(".orapa-mp__guess-panel")!;
    const peekToggle = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__peek-toggle")!;
    const peekHint = controlsHost.querySelector<HTMLParagraphElement>(".orapa-mp__peek-hint")!;
    const markToggle = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__mark-toggle")!;
    const markHint = controlsHost.querySelector<HTMLParagraphElement>(".orapa-mp__mark-hint")!;
    const reflectToggle = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__reflect-toggle")!;
    const reflectPanel = controlsHost.querySelector<HTMLDivElement>(".orapa-mp__reflect-panel")!;
    // "none" par défaut : un simple clic sur une case ne déclenche plus
    // rien tant qu'un de ces 3 outils n'est pas explicitement choisi —
    // corrige un vrai bug où faire tourner la vue à la souris pouvait,
    // en fin de rotation, poser une question sur la case survolée
    // (retour utilisateur direct ; voir aussi le correctif clic/glissé
    // dans board-scene.ts, qui protège même le tir de rayon sur les
    // bornes). Tirer un rayon reste indépendant de ces 3 outils : les
    // bornes du pourtour sont des cibles distinctes des cases.
    let askSubMode: "none" | "peek" | "mark" | "reflect" = "none";

    const setAskSubMode = (next: "none" | "peek" | "mark" | "reflect") => {
      askSubMode = next;
      peekToggle.classList.toggle("is-selected", next === "peek");
      markToggle.classList.toggle("is-selected", next === "mark");
      reflectToggle.classList.toggle("is-selected", next === "reflect");
      peekHint.hidden = next !== "peek";
      markHint.hidden = next !== "mark";
      reflectPanel.hidden = next !== "reflect";
      if (!scene) return;
      if (next === "reflect") {
        if (!reflectionController) {
          reflectionController = new ReflectionController({
            scene,
            paletteHost: reflectPanel.querySelector(".orapa-mp__reflect-palette")!,
            rotateButton: reflectPanel.querySelector(".orapa-demo__rotate")!,
            mirrorButton: reflectPanel.querySelector(".orapa-demo__mirror")!,
            clearButton: reflectPanel.querySelector(".orapa-mp__reflect-clear")!,
            statusHost: reflectPanel.querySelector(".orapa-mp__reflect-status")!,
            entries: reflectionEntries(room?.extensions_enabled ?? false),
          });
        } else {
          reflectionController.activate();
        }
      } else {
        // Ne fait que rendre la main sur les callbacks de la scène : les
        // repères déjà posés restent affichés (groupe séparé, voir
        // board-scene.ts), seul le contrôleur "lâche" la souris.
        reflectionController?.dispose();
        scene.setGhost(null);
        scene.onCornerClick = ({ corner }) => {
          // Marquer une case ne dépend jamais du tour : outil personnel,
          // pas une question posée à l'adversaire (voir board-scene.ts).
          if (askSubMode === "mark") {
            scene!.toggleMark(corner);
            return;
          }
          if (askSubMode !== "peek") return; // rien d'armé : clic ignoré
          if (!isMyTurn()) {
            pushLog("⚠️ Ce n'est pas ton tour.");
            return;
          }
          sendAskPeek(socket!, corner);
        };
        scene.onCornerHover = null;
      }
    };

    peekToggle.addEventListener("click", () => setAskSubMode(askSubMode === "peek" ? "none" : "peek"));
    markToggle.addEventListener("click", () => setAskSubMode(askSubMode === "mark" ? "none" : "mark"));
    reflectToggle.addEventListener("click", () => setAskSubMode(askSubMode === "reflect" ? "none" : "reflect"));

    const setMode = (next: "ask" | "guess") => {
      mode = next;
      askBtn.classList.toggle("is-selected", next === "ask");
      guessBtn.classList.toggle("is-selected", next === "guess");
      askPanel.hidden = next !== "ask";
      guessPanel.hidden = next !== "guess";
      if (!scene) return;
      if (next === "ask") {
        guessController?.dispose();
        scene.setPieces([]);
        // Réapplique le sous-mode courant (question/marquage/réflexion) :
        // ré-attache les callbacks de la scène, que le mode "proposition"
        // avait pris (les repères de réflexion déjà posés restent
        // affichés — groupe séparé, voir board-scene.ts).
        setAskSubMode(askSubMode);
      } else if (!guessController) {
        guessController = new PlacementController({
          scene,
          paletteHost: guessPanel.querySelector(".orapa-demo__palette")!,
          previewHost: guessPanel.querySelector(".orapa-place__preview-box")!,
          rotateButton: guessPanel.querySelector(".orapa-demo__rotate")!,
          mirrorButton: guessPanel.querySelector(".orapa-demo__mirror")!,
          validateButton: guessPanel.querySelector(".orapa-demo__validate")!,
          clearButton: guessPanel.querySelector(".orapa-demo__bulk-clear")!,
          randomButton: guessPanel.querySelector(".orapa-demo__bulk-random")!,
          validateLabel: "Proposer cette solution",
          statusHost: guessPanel.querySelector(".orapa-mp__guess-status")!,
          extensionPieces: room!.extensions_enabled ? EXTENSION_PIECE_PALETTE : undefined,
          onValidate: (pieces) => sendSubmitSolution(socket!, pieces),
        });
      } else {
        // Contrôleur déjà construit (proposition en cours) : juste
        // reprendre la main sur les callbacks de la scène, que le
        // passage en mode "question" lui avait retirés.
        guessController.activate();
      }
    };

    askBtn.addEventListener("click", () => setMode("ask"));
    guessBtn.addEventListener("click", () => setMode("guess"));
    setMode(mode);

    scene!.onEntryClick = ({ label }) => {
      if (!isMyTurn()) {
        pushLog("⚠️ Ce n'est pas ton tour.");
        return;
      }
      sendAskRay(socket!, label);
    };
    updateTurnIndicator(phaseHost);
    applyTurnGating(controlsHost);
  }

  // Cache : "poser une question" / "proposer une solution" ne sont
  // cliquables/visibles que si c'est le tour du joueur (retour
  // utilisateur direct).
  function applyTurnGating(controlsHost: HTMLElement): void {
    const askBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__ask-btn");
    const guessBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__guess-btn");
    if (!askBtn || !guessBtn) return; // pas la phase PLAYING
    const myTurn = isMyTurn();
    askBtn.hidden = !myTurn;
    guessBtn.hidden = !myTurn;
  }

  function renderFinished(phaseHost: HTMLElement): void {
    const state = lastGameState;
    let text = "Partie terminée.";
    if (state?.draw) text = "Match nul !";
    else if (state?.winner === playerId) text = "🎉 Tu as gagné !";
    else if (state?.winner) text = "Tu as perdu — l'adversaire a trouvé la solution.";
    phaseHost.innerHTML = `<p class="orapa-mp__result-banner">${text}</p>`;
  }

  function updateTurnIndicator(phaseHost: HTMLElement): void {
    const el = phaseHost.querySelector<HTMLParagraphElement>(".orapa-mp__turn");
    if (!el || !room) return;
    const state = lastGameState;
    if (!state) {
      el.textContent = "";
      return;
    }
    const turnPlayer = room.mode === "DUEL" ? state.current_prospector : state.current_turn_player;
    if (turnPlayer === playerId) {
      el.textContent = "À toi de jouer.";
    } else if (turnPlayer) {
      const name = room.players.find((p) => p.id === turnPlayer)?.name ?? turnPlayer;
      el.textContent = `Au tour de ${name}.`;
    } else {
      el.textContent = "";
    }
  }

  function pushLog(line: string): void {
    log.push(line);
    if (log.length > 30) log.shift();
    const logHost = root.querySelector<HTMLDivElement>(".orapa-mp__log");
    if (logHost) logHost.innerHTML = log.map((l) => `<div>${l}</div>`).join("");
  }

  // --- câblage des messages serveur ----------------------------------------

  function wireSocket(ws: RoomSocket): void {
    ws.on("joined", (msg) => {
      playerId = msg.player_id as string;
      room = msg.room as RoomPayload;
      render();
    });
    ws.on("room_update", (msg) => {
      room = msg.room as RoomPayload;
      render();
    });
    ws.on("game_state", (msg) => {
      lastGameState = msg as unknown as GameStatePayload;
      const phaseHost = root.querySelector<HTMLDivElement>(".orapa-mp__phase");
      if (phaseHost) {
        if (room?.status === "FINISHED") renderFinished(phaseHost);
        else updateTurnIndicator(phaseHost);
      }
      const controlsHost = root.querySelector<HTMLDivElement>(".orapa-mp__game-controls");
      if (controlsHost) applyTurnGating(controlsHost);
    });
    ws.on("placement_ack", () => {
      /* la pose optimiste locale a déjà mis à jour l'affichage */
    });
    ws.on("player_ready", (msg) => {
      const id = msg.player_id as string;
      const name = room?.players.find((p) => p.id === id)?.name ?? id;
      pushLog(`${name} a validé son placement.`);
    });
    ws.on("ray_result", (msg) => {
      const result = msg.result as RayResultPayload;
      const label = msg.entry_label as string;
      pushLog(describeRay(label, result));
      if (scene && mode === "ask") {
        // Colore durablement les bornes d'entrée/sortie plutôt que de
        // tracer une ligne éphémère (voir `BoardScene.colorEntryMarker`) :
        // un tracé disparaissait au tir suivant, ce qui compliquait la
        // résolution — retour utilisateur direct. Pour un plateau fixe,
        // une borne ne peut produire qu'une seule couleur, donc les
        // colorer une à une construit une vraie carte des questions
        // déjà posées.
        scene.colorEntryMarker(label, result.absorbed ? "absorbé" : result.color);
        if (!result.absorbed && result.exit) {
          const exitLabel = labelForExit(result.exit, result.exit_direction!);
          scene.colorEntryMarker(exitLabel, result.color);
        }
      }
    });
    ws.on("peek_result", (msg) => {
      const position = msg.position as Position;
      pushLog(`Qu'y a-t-il en ${cellLabel(position)} ? ${colorizePeekResult(msg.result as string)}`);
    });
    ws.on("error", (msg) => {
      // ⚠️ Limite connue (voir docs/plan.md) : une pose optimiste que le
      // serveur rejetterait resterait affichée localement jusqu'au
      // prochain rechargement — pas de rollback ciblé en v1 (pas
      // d'identifiant de requête pour relier l'erreur à la pièce
      // concernée). En pratique, le moteur TS local (`preview-engine.ts`)
      // applique exactement les mêmes règles que le serveur, donc ce
      // cas ne devrait pas se produire hors bug.
      pushLog(`⚠️ ${msg.message as string}`);
    });
  }

  return () => {
    socket?.close();
    scene?.dispose();
    placementController?.dispose();
    guessController?.dispose();
    reflectionController?.dispose();
  };
}

function describeRay(label: string, result: RayResultPayload): string {
  if (result.absorbed) return `Rayon depuis ${label} : signal absorbé.`;
  const exitLabel = labelForExit(result.exit!, result.exit_direction!);
  return `Rayon depuis ${label} : sort en ${exitLabel} — couleur ${colorBadgeHtml(result.color)}.`;
}

// `peek()` (backend) répond par une phrase complète ("Une gemme rouge"),
// pas juste un nom de couleur — les adjectifs français (accord au
// féminin pour bleue/blanche) ne correspondent pas tous littéralement
// aux clés de `RAY_COLOR_HEX` ("bleu", "blanc").
const PEEK_COLOR_WORDS: Record<string, string> = {
  rouge: "rouge",
  jaune: "jaune",
  bleue: "bleu",
  blanche: "blanc",
};

function colorizePeekResult(text: string): string {
  for (const [word, canonical] of Object.entries(PEEK_COLOR_WORDS)) {
    if (text.endsWith(word)) {
      return `${text.slice(0, text.length - word.length)}${colorBadgeHtml(canonical)}`;
    }
  }
  return text;
}

/** `navigator.clipboard` n'existe que dans un contexte sécurisé (HTTPS
 * ou `localhost`) — absent (ou qui lève) sur une IP locale en HTTP
 * (test sur le même Wi-Fi, voir README) ou un tunnel sans TLS, d'où le
 * bouton "Copier le lien" silencieusement inopérant rapporté par
 * l'utilisateur. Repli sur `execCommand("copy")` (déprécié mais encore
 * largement supporté, exactement pour ce cas) ; si les deux échouent,
 * sélectionne au moins le texte dans `fallbackInput` pour un Ctrl+C
 * manuel. Renvoie `true` seulement si une vraie copie a eu lieu. */
async function copyToClipboard(text: string, fallbackInput: HTMLInputElement): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // repli ci-dessous
    }
  }
  fallbackInput.focus();
  fallbackInput.select();
  try {
    if (document.execCommand("copy")) return true;
  } catch {
    // repli ci-dessous
  }
  return false;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
