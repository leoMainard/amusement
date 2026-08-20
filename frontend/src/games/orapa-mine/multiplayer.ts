/**
 * Écran multijoueur Orapa Mine : créer/rejoindre un salon par lien,
 * lobby, placement (Duel — le vrai paravent est le serveur, qui ne
 * renvoie jamais le plateau adverse en clair), puis prospection
 * (questions + proposition de solution).
 *
 * ⚠️ Contrairement à la démo hors ligne (`demo.ts`), ce module ne
 * contient AUCUNE logique de jeu : chaque action passe par le serveur
 * (`protocol.ts`), qui reste seul juge de ce qui est valide. Le rayon
 * n'est tracé qu'en ligne droite entrée→sortie (pas de rebonds
 * intermédiaires affichés) : contrairement à la démo locale, le serveur
 * ne renvoie que l'entrée et la sortie — exposer les points de rebond
 * donnerait plus d'information que le jeu physique n'en donne jamais à
 * un vrai prospecteur.
 */

import { BoardScene } from "./board-scene";
import { labelForExit } from "./entry-labels";
import { toContinuousCorner } from "./geometry";
import { PlacementController } from "./placement-controller";
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
import { DEFAULT_DIMENSIONS, EXTENSION_PIECE_PALETTE, type Position } from "./types";

const MODE_LABELS: Record<RoomMode, string> = {
  DUEL: "Duel (1 contre 1, règles officielles)",
  FOUILLE_PARALLEL: "Fouille — chacun son plateau, en parallèle",
  FOUILLE_TURN_BASED: "Fouille — plateau commun, tour par tour",
};

export function mountOrapaMineMultiplayer(root: HTMLElement): () => void {
  let socket: RoomSocket | null = null;
  let scene: BoardScene | null = null;
  let placementController: PlacementController | null = null;
  let guessController: PlacementController | null = null;
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
              <option value="FOUILLE_PARALLEL">${MODE_LABELS.FOUILLE_PARALLEL}</option>
              <option value="FOUILLE_TURN_BASED">${MODE_LABELS.FOUILLE_TURN_BASED}</option>
            </select>
          </label>
          <label class="orapa-mp__max-players">Nombre de joueurs
            <input type="number" class="orapa-mp__max-players-input" min="2" max="8" value="2" disabled />
          </label>
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
    modeSelect.addEventListener("change", () => {
      const isDuel = modeSelect.value === "DUEL";
      maxPlayersInput.disabled = isDuel;
      maxPlayersInput.value = isDuel ? "2" : "3";
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
    host.querySelector<HTMLButtonElement>(".orapa-mp__copy")!.addEventListener("click", async () => {
      await navigator.clipboard.writeText(link);
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

    if (room.status === "PLACING") {
      renderPlacing(phaseHost, controlsHost);
    } else if (room.status === "PLAYING") {
      renderPlaying(phaseHost, controlsHost);
    } else if (room.status === "FINISHED") {
      renderFinished(phaseHost);
      scene.setGhost(null);
    }
  }

  function renderPlacing(phaseHost: HTMLElement, controlsHost: HTMLElement): void {
    phaseHost.innerHTML = `<p>Place tes 5 gemmes sur <strong>ton</strong> plateau, à l'abri des regards.</p>`;
    controlsHost.innerHTML = `
      <div class="orapa-demo__palette"></div>
      <div class="orapa-demo__transform">
        <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
        <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
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
      rotateButton: controlsHost.querySelector(".orapa-demo__rotate")!,
      mirrorButton: controlsHost.querySelector(".orapa-demo__mirror")!,
      validateButton: controlsHost.querySelector(".orapa-demo__validate")!,
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

  function renderPlaying(phaseHost: HTMLElement, controlsHost: HTMLElement): void {
    phaseHost.innerHTML = `<p class="orapa-mp__turn"></p>`;
    controlsHost.innerHTML = `
      <div class="orapa-mp__mode-toggle">
        <button type="button" class="orapa-mp__ask-btn">Poser une question</button>
        <button type="button" class="orapa-mp__guess-btn">Proposer une solution</button>
      </div>
      <div class="orapa-mp__ask-panel">
        <p class="orapa-demo__hint">Clique une borne du pourtour pour tirer un rayon, ou une case pour demander ce qu'elle contient.</p>
      </div>
      <div class="orapa-mp__guess-panel" hidden>
        <div class="orapa-demo__palette"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
        </div>
        <button type="button" class="orapa-demo__validate" disabled>Proposer cette solution (0/5)</button>
        <p class="orapa-demo__result orapa-mp__guess-status" aria-live="polite"></p>
      </div>
    `;

    const askBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__ask-btn")!;
    const guessBtn = controlsHost.querySelector<HTMLButtonElement>(".orapa-mp__guess-btn")!;
    const askPanel = controlsHost.querySelector<HTMLDivElement>(".orapa-mp__ask-panel")!;
    const guessPanel = controlsHost.querySelector<HTMLDivElement>(".orapa-mp__guess-panel")!;

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
        scene.setGhost(null);
        scene.onCornerClick = ({ corner }) => sendAskPeek(socket!, corner);
        scene.onCornerHover = null;
      } else if (!guessController) {
        guessController = new PlacementController({
          scene,
          paletteHost: guessPanel.querySelector(".orapa-demo__palette")!,
          rotateButton: guessPanel.querySelector(".orapa-demo__rotate")!,
          mirrorButton: guessPanel.querySelector(".orapa-demo__mirror")!,
          validateButton: guessPanel.querySelector(".orapa-demo__validate")!,
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

    scene!.onEntryClick = ({ label }) => sendAskRay(socket!, label);
    updateTurnIndicator(phaseHost);
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
    if (room.mode === "FOUILLE_PARALLEL") {
      el.textContent = "Chacun joue à son rythme.";
    } else if (turnPlayer === playerId) {
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
        if (result.absorbed || !result.exit) {
          scene.clearRay();
        } else {
          // Ligne droite entrée -> sortie uniquement (voir docstring du
          // module : pas de rebonds intermédiaires affichés, le serveur
          // ne les renvoie pas non plus). `entry`/`exit` sont des
          // positions DISCRÈTES (le serveur parle la même convention que
          // borders.ts) : il faut les convertir en continu avant de les
          // passer à animateRay, sans quoi le tracé se décale d'une
          // demi-case.
          scene.animateRay(toContinuousCorner(result.entry), [{ position: toContinuousCorner(result.exit), direction: result.exit_direction! }], result.color);
        }
      }
    });
    ws.on("peek_result", (msg) => {
      const position = msg.position as Position;
      pushLog(`Qu'y a-t-il en (${position[0]}, ${position[1]}) ? ${msg.result as string}`);
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
  };
}

function describeRay(label: string, result: RayResultPayload): string {
  if (result.absorbed) return `Rayon depuis ${label} : signal absorbé.`;
  const exitLabel = labelForExit(result.exit!, result.exit_direction!);
  return `Rayon depuis ${label} : sort en ${exitLabel} — couleur ${result.color}.`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
