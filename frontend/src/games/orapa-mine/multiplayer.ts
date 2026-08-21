/**
 * Écran multijoueur Orapa Mine : créer/rejoindre un salon par lien,
 * lobby, placement (Duel — le vrai paravent est le serveur, qui ne
 * renvoie jamais le plateau adverse en clair), puis prospection
 * (questions + proposition de solution). Mise en page reprise de
 * `claude_design/Orapa Mine.dc.html` : cartes de mode pour créer une
 * partie, plateau plein cadre avec panneaux "verre" flottants pendant
 * la partie (historique à gauche, dernière réponse/carnet/proposition
 * à droite, outils de question en bas).
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

import { BoardScene, RAY_COLOR_HEX } from "./board-scene";
import { colorBadgeHtml, hexColor } from "./color-swatch";
import { cellLabel, labelForExit } from "./entry-labels";
import { PlacementController } from "./placement-controller";
import { ReflectionController, type ReflectionPaletteEntry } from "./reflection-controller";
import { mountHelpDialog } from "./help-panel";
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

const MODE_NAMES: Record<RoomMode, string> = { DUEL: "Duel", FOUILLE: "Fouille" };

const MODE_CARD_INFO: Record<RoomMode, { desc: string; tag: string }> = {
  DUEL: {
    desc: "Chacun place ses 5 gemmes en secret. Les rôles alternent : prospecteur, puis maître du jeu. Une proposition erronée fait perdre immédiatement.",
    tag: "2 JOUEURS",
  },
  FOUILLE: {
    desc: "Plateau commun généré au hasard. Chacun pose ses questions sur son propre exemplaire, à son rythme — jouable seul ou à plusieurs, tour par tour.",
    tag: "1 JOUEUR ET +",
  },
};

/** Palette du panneau de réflexion : les 5 pièces complètes, les
 * extensions si le salon les autorise, et les repères élémentaires
 * (case/demi-case colorée) — voir `reflection-controller.ts`. */
function reflectionEntries(extensionsEnabled: boolean): ReflectionPaletteEntry[] {
  return [...BASE_PIECE_PALETTE, ...(extensionsEnabled ? EXTENSION_PIECE_PALETTE : []), ...REFLECTION_UNIT_PALETTE];
}

function modeCardHtml(mode: RoomMode, selected: RoomMode): string {
  const info = MODE_CARD_INFO[mode];
  return `
    <button type="button" class="orapa-mp__mode-card ${mode === selected ? "is-selected" : ""}" data-mode="${mode}">
      <span class="orapa-mp__mode-card-title">${MODE_NAMES[mode]}</span>
      <p>${info.desc}</p>
      <span class="orapa-mp__mode-card-tag">${info.tag}</span>
    </button>
  `;
}

interface HistoryEntry {
  html: string;
  accent: string;
}

export function mountOrapaMineMultiplayer(root: HTMLElement): () => void {
  let socket: RoomSocket | null = null;
  let scene: BoardScene | null = null;
  let placementController: PlacementController | null = null;
  let guessController: PlacementController | null = null;
  let reflectionController: ReflectionController | null = null;
  let playerId = "";
  let room: RoomPayload | null = null;
  let lastGameState: GameStatePayload | null = null;
  const history: HistoryEntry[] = [];

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
    let selectedMode: RoomMode = "DUEL";

    function paint(): void {
      host.innerHTML = `
        <div class="orapa-mp__setup-heading">
          <span class="orapa-mp__setup-icon" aria-hidden="true">
            <span class="orapa-mp__setup-icon-shape orapa-mp__setup-icon-shape--tri"></span>
            <span class="orapa-mp__setup-icon-shape orapa-mp__setup-icon-shape--para"></span>
          </span>
          <h1>Créer une partie</h1>
        </div>
        <div class="orapa-mp__mode-cards">
          ${modeCardHtml("DUEL", selectedMode)}
          ${modeCardHtml("FOUILLE", selectedMode)}
        </div>
        <div class="orapa-mp__setup">
          <section class="orapa-mp__panel">
            <h3>Ta partie</h3>
            <label>Ton nom <input type="text" class="orapa-mp__create-name" value="Joueur 1" /></label>
            <label class="orapa-mp__max-players" ${selectedMode === "DUEL" ? "hidden" : ""}>
              Nombre de joueurs <span class="orapa-mp__max-players-value">1</span>
              <input type="range" class="orapa-mp__max-players-input" min="1" max="5" value="1" />
            </label>
            <p class="orapa-mp__max-players-hint" ${selectedMode === "DUEL" ? "hidden" : ""}>1 joueur : tu joues seul.</p>
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
            <p class="orapa-mp__extensions-hint">Le code t'est donné par l'hôte de la partie.</p>
          </section>
        </div>
        <p class="orapa-mp__error" aria-live="polite"></p>
      `;

      for (const card of host.querySelectorAll<HTMLButtonElement>(".orapa-mp__mode-card")) {
        card.addEventListener("click", () => {
          selectedMode = card.dataset.mode as RoomMode;
          paint();
        });
      }

      const errorHost = host.querySelector<HTMLParagraphElement>(".orapa-mp__error")!;
      const maxPlayersInput = host.querySelector<HTMLInputElement>(".orapa-mp__max-players-input")!;
      const maxPlayersValue = host.querySelector<HTMLSpanElement>(".orapa-mp__max-players-value")!;
      maxPlayersInput.addEventListener("input", () => {
        maxPlayersValue.textContent = maxPlayersInput.value;
      });
      const extensionsInput = host.querySelector<HTMLInputElement>(".orapa-mp__extensions-input")!;

      host.querySelector<HTMLButtonElement>(".orapa-mp__create-btn")!.addEventListener("click", async () => {
        errorHost.textContent = "";
        const name = host.querySelector<HTMLInputElement>(".orapa-mp__create-name")!.value.trim() || "Joueur";
        const maxPlayers = selectedMode === "DUEL" ? 2 : Number(maxPlayersInput.value) || 1;
        try {
          const created = await createRoom(selectedMode, maxPlayers, extensionsInput.checked);
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

    paint();
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
      <div class="orapa-mp__mode-cards orapa-mp__mode-cards--static">
        <span class="orapa-mp__mode-pill">${MODE_NAMES[room.mode]}</span>
      </div>
      <div class="orapa-mp__lobby-panel">
        <span class="om-eyebrow">Code de la partie — clique pour copier</span>
        <button type="button" class="orapa-mp__code">${room.code}</button>
        <div class="orapa-mp__share">
          <input type="text" readonly class="orapa-mp__link" value="${link}" />
          <button type="button" class="orapa-mp__copy">Copier le lien</button>
        </div>
        <p class="orapa-mp__extensions-label">
          ${room.extensions_enabled ? "Extensions activées (Diamant, Corps noir)" : "Extensions désactivées (5 gemmes de base uniquement)"}
        </p>
        <ul class="orapa-mp__players">
          ${room.players.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}
        </ul>
        <p class="orapa-mp__wait-text">${room.players.length}/${room.max_players} joueur${room.max_players > 1 ? "s" : ""} — en attente...</p>
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

    // Le code lui-même est directement cliquable pour le copier (pas
    // seulement le lien complet, retour utilisateur direct) : passe par
    // le même repli `execCommand` que le lien, via `linkInput` (déjà
    // présent dans la page) pour la sélection de secours.
    const codeButton = host.querySelector<HTMLButtonElement>(".orapa-mp__code")!;
    const originalCodeLabel = codeButton.textContent ?? room.code;
    codeButton.addEventListener("click", async () => {
      const copied = await copyToClipboard(room!.code, linkInput);
      codeButton.textContent = copied ? "Copié !" : "Ctrl+C pour copier";
      setTimeout(() => {
        codeButton.textContent = originalCodeLabel;
      }, 2000);
    });
  }

  // --- Écran 3 : la partie (placement puis prospection) --------------------

  function renderGame(host: HTMLElement): void {
    if (!room) return;

    if (room.status === "PLAYING") {
      host.innerHTML = `
        <div class="orapa-play">
          <div class="orapa-play__topbar">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div class="orapa-play__mode">${MODE_NAMES[room.mode]}</div>
              <p class="orapa-mp__turn"></p>
            </div>
            <div style="display: flex; align-items: center; gap: 14px;">
              <button type="button" class="om-help-btn orapa-play__help-btn">❔ Aide</button>
              <div style="font-size: 12.5px; color: var(--om-text-5);">Glisse pour tourner la vue · molette pour zoomer</div>
            </div>
          </div>
          <div class="orapa-play__layout">
            <div class="orapa-play__history">
              <div class="orapa-play__panel-head">
                <span class="om-eyebrow">Historique</span>
                <span class="orapa-play__history-count"></span>
              </div>
              <div class="orapa-play__history-list"></div>
            </div>

            <div class="orapa-play__center">
              <div class="orapa-play__canvas"></div>

              <div class="orapa-play__toggles">
                <button type="button" class="orapa-mp__mark-toggle">✕ Marquer des cases</button>
                <button type="button" class="orapa-mp__reflect-toggle">🧩 Placer des repères</button>
              </div>
              <div class="orapa-mp__reflect-panel" hidden>
                <p class="orapa-demo__hint">
                  Pose une gemme entière ou juste un repère (case ou demi-case colorée) comme hypothèse
                  personnelle — visible pendant que tu poses des questions, jamais transmis à
                  l'adversaire. Reclique une pièce posée (elle se teinte en rouge au survol) pour la
                  retirer.
                </p>
                <div class="orapa-demo__palette orapa-mp__reflect-palette"></div>
                <div class="orapa-demo__transform">
                  <button type="button" class="orapa-demo__rotate">⟳ Pivoter (R)</button>
                  <button type="button" class="orapa-demo__mirror">⇋ Retourner (F)</button>
                </div>
                <button type="button" class="orapa-mp__reflect-clear">Vider mes repères</button>
                <p class="orapa-demo__result orapa-mp__reflect-status" aria-live="polite"></p>
              </div>

              <div class="orapa-play__tools">
                <div class="orapa-play__tool">
                  <span class="om-eyebrow">Tirer un rayon</span>
                  <p>Clique un point d'entrée du plateau (1–18 ou A–R), ou saisis-le ici.</p>
                  <div class="orapa-play__tool-row">
                    <input type="text" class="orapa-play__entry-input" placeholder="ex. 7 ou K" maxlength="3" />
                    <button type="button" class="orapa-play__fire-btn">Envoyer</button>
                  </div>
                </div>
                <div class="orapa-play__tool-divider"></div>
                <div class="orapa-play__tool">
                  <span class="om-eyebrow">Interroger une case</span>
                  <p>Clique une case du plateau : on te dit ce qu'elle contient.</p>
                  <div class="orapa-play__tool-row">
                    <div class="orapa-play__target-label">—</div>
                    <button type="button" class="orapa-play__ask-btn" disabled>Demander</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="orapa-play__side orapa-play__side--ask">
              <div class="orapa-play__answer">
                <span class="om-eyebrow">Dernière réponse</span>
                <div class="orapa-play__answer-body">Aucune question posée pour l'instant.</div>
              </div>
              <div class="orapa-play__notes">
                <span class="om-eyebrow">Carnet</span>
                <textarea class="orapa-mp__notepad" placeholder="Note ce que tu veux ici — déductions, cases à retenir..."></textarea>
              </div>
              <button type="button" class="orapa-play__propose">Proposer la disposition</button>
            </div>

            <div class="orapa-play__side orapa-play__side--guess" hidden>
              <div class="orapa-place__preview"><span class="om-eyebrow">Aperçu</span></div>
              <div class="orapa-place__preview-box"></div>
              <div class="orapa-demo__transform">
                <button type="button" class="orapa-demo__rotate">⟳ Pivoter (R)</button>
                <button type="button" class="orapa-demo__mirror">⇋ Retourner (F)</button>
              </div>
              <span class="om-eyebrow">Ta proposition</span>
              <div class="orapa-demo__palette"></div>
              <div class="orapa-demo__bulk-actions">
                <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
                <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
              </div>
              <button type="button" class="orapa-demo__validate" disabled>Proposer cette solution (0/5)</button>
              <button type="button" class="orapa-play__cancel-guess">← Annuler, revenir aux questions</button>
              <p class="orapa-demo__result orapa-play__guess-status" aria-live="polite"></p>
            </div>
          </div>
        </div>
      `;
      const canvasHost = host.querySelector<HTMLDivElement>(".orapa-play__canvas")!;
      if (!scene) {
        scene = new BoardScene(canvasHost, DEFAULT_DIMENSIONS);
      } else {
        scene.attachTo(canvasHost);
      }
      setUpNotepad(host.querySelector<HTMLTextAreaElement>(".orapa-mp__notepad")!);
      renderHistory();
      renderPlaying(host);
      updateTurnIndicator();
      const helpDialog = mountHelpDialog(host);
      host.querySelector<HTMLButtonElement>(".orapa-play__help-btn")!.addEventListener("click", () => helpDialog.open());
      return;
    }

    // PLACING / FINISHED : mise en page canvas + panneau latéral.
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
    setUpNotepad(host.querySelector<HTMLTextAreaElement>(".orapa-mp__notepad")!);
    renderHistory();

    if (room.status === "PLACING") {
      renderPlacing(phaseHost, controlsHost);
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
        <button type="button" class="orapa-demo__rotate">⟳ Pivoter (R)</button>
        <button type="button" class="orapa-demo__mirror">⇋ Retourner (F)</button>
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

  // --- Écran "partie en cours" : plateau plein cadre + panneaux flottants --

  function renderPlaying(host: HTMLElement): void {
    const sideAsk = host.querySelector<HTMLDivElement>(".orapa-play__side--ask")!;
    const sideGuess = host.querySelector<HTMLDivElement>(".orapa-play__side--guess")!;
    const toggles = host.querySelector<HTMLDivElement>(".orapa-play__toggles")!;
    const tools = host.querySelector<HTMLDivElement>(".orapa-play__tools")!;
    const markToggle = host.querySelector<HTMLButtonElement>(".orapa-mp__mark-toggle")!;
    const reflectToggle = host.querySelector<HTMLButtonElement>(".orapa-mp__reflect-toggle")!;
    const reflectPanel = host.querySelector<HTMLDivElement>(".orapa-mp__reflect-panel")!;
    const entryInput = host.querySelector<HTMLInputElement>(".orapa-play__entry-input")!;
    const fireBtn = host.querySelector<HTMLButtonElement>(".orapa-play__fire-btn")!;
    const targetLabelEl = host.querySelector<HTMLDivElement>(".orapa-play__target-label")!;
    const askBtn = host.querySelector<HTMLButtonElement>(".orapa-play__ask-btn")!;
    const proposeBtn = host.querySelector<HTMLButtonElement>(".orapa-play__propose")!;
    const cancelGuessBtn = host.querySelector<HTMLButtonElement>(".orapa-play__cancel-guess")!;

    let proposing = false;
    // "none" par défaut : un clic simple sur une case la SÉLECTIONNE
    // juste (voir `askTarget` — le vrai envoi passe par le bouton
    // "Demander", jamais un clic seul) ; "mark" bascule ce clic en
    // croix personnelle à la place. Corrige un vrai bug où faire
    // tourner la vue à la souris pouvait, en fin de rotation, poser à
    // tort une question sur la case survolée (retour utilisateur
    // direct) — désormais un simple clic ne déclenche jamais d'envoi.
    let askSubMode: "none" | "mark" | "reflect" = "none";
    let askTarget: Position | null = null;

    const setAskSubMode = (next: "none" | "mark" | "reflect") => {
      askSubMode = next;
      markToggle.classList.toggle("is-selected", next === "mark");
      reflectToggle.classList.toggle("is-selected", next === "reflect");
      reflectPanel.hidden = next !== "reflect";
      if (!scene || proposing) return;
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
        scene.onCornerHover = null;
        scene.onCornerClick = ({ corner }) => {
          if (askSubMode === "mark") {
            // Marquer une case ne dépend jamais du tour : outil
            // personnel, pas une question posée à l'adversaire.
            scene!.toggleMark(corner);
            return;
          }
          askTarget = corner;
          targetLabelEl.textContent = cellLabel(corner);
          askBtn.disabled = false;
        };
      }
    };

    markToggle.addEventListener("click", () => setAskSubMode(askSubMode === "mark" ? "none" : "mark"));
    reflectToggle.addEventListener("click", () => setAskSubMode(askSubMode === "reflect" ? "none" : "reflect"));

    const setProposing = (next: boolean) => {
      proposing = next;
      sideAsk.hidden = next;
      sideGuess.hidden = !next;
      toggles.hidden = next;
      tools.hidden = next;
      if (!scene) return;
      if (next) {
        reflectionController?.dispose();
        reflectPanel.hidden = true;
        if (!guessController) {
          guessController = new PlacementController({
            scene,
            paletteHost: sideGuess.querySelector(".orapa-demo__palette")!,
            previewHost: sideGuess.querySelector(".orapa-place__preview-box")!,
            rotateButton: sideGuess.querySelector(".orapa-demo__rotate")!,
            mirrorButton: sideGuess.querySelector(".orapa-demo__mirror")!,
            validateButton: sideGuess.querySelector(".orapa-demo__validate")!,
            clearButton: sideGuess.querySelector(".orapa-demo__bulk-clear")!,
            randomButton: sideGuess.querySelector(".orapa-demo__bulk-random")!,
            validateLabel: "Proposer cette solution",
            statusHost: sideGuess.querySelector(".orapa-play__guess-status")!,
            extensionPieces: room!.extensions_enabled ? EXTENSION_PIECE_PALETTE : undefined,
            onValidate: (pieces) => sendSubmitSolution(socket!, pieces),
          });
        } else {
          guessController.activate();
        }
      } else {
        guessController?.dispose();
        scene.setPieces([]);
        setAskSubMode(askSubMode);
      }
    };

    proposeBtn.addEventListener("click", () => setProposing(true));
    cancelGuessBtn.addEventListener("click", () => setProposing(false));

    // Cliquer une borne du pourtour ne tire plus le rayon directement :
    // ça remplit juste le champ, "Envoyer" (ou Entrée) reste nécessaire
    // — même logique de confirmation explicite que pour "Demander"
    // ci-dessous (voir la maquette Claude Design).
    scene!.onEntryClick = ({ label }) => {
      entryInput.value = label;
    };

    const fireEntry = () => {
      const label = entryInput.value.trim().toUpperCase();
      if (!label) return;
      if (!isMyTurn()) {
        pushHistory("⚠️ Ce n'est pas ton tour.");
        return;
      }
      sendAskRay(socket!, label);
      entryInput.value = "";
    };
    fireBtn.addEventListener("click", fireEntry);
    entryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") fireEntry();
    });

    askBtn.addEventListener("click", () => {
      if (!askTarget) return;
      if (!isMyTurn()) {
        pushHistory("⚠️ Ce n'est pas ton tour.");
        return;
      }
      sendAskPeek(socket!, askTarget);
      askTarget = null;
      targetLabelEl.textContent = "—";
      askBtn.disabled = true;
    });

    setAskSubMode(askSubMode);
  }

  function renderFinished(phaseHost: HTMLElement): void {
    const state = lastGameState;
    let text = "Partie terminée.";
    if (state?.draw) text = "Match nul !";
    else if (state?.winner === playerId) text = "🎉 Tu as gagné !";
    else if (state?.winner) text = "Tu as perdu — l'adversaire a trouvé la solution.";
    phaseHost.innerHTML = `<p class="orapa-mp__result-banner">${text}</p>`;
  }

  function updateTurnIndicator(): void {
    const el = root.querySelector<HTMLParagraphElement>(".orapa-mp__turn");
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

  // --- Historique (panneau gauche en jeu, journal dans les autres écrans) --

  function pushHistory(html: string, accent: string = "var(--om-border)"): void {
    history.push({ html, accent });
    if (history.length > 30) history.shift();
    renderHistory();
  }

  function renderHistory(): void {
    // Écran "partie en cours" : panneau HISTORIQUE dédié (plus récent en
    // premier, comme la maquette).
    const list = root.querySelector<HTMLDivElement>(".orapa-play__history-list");
    if (list) {
      list.innerHTML = history.length
        ? [...history]
            .reverse()
            .map((h) => `<div class="orapa-play__history-row" style="border-left-color:${h.accent}">${h.html}</div>`)
            .join("")
        : `<div class="orapa-play__history-empty">Clique une case pour l'interroger, ou un point du bord pour tirer un rayon.</div>`;
    }
    const countEl = root.querySelector<HTMLSpanElement>(".orapa-play__history-count");
    if (countEl) countEl.textContent = `${history.length} question${history.length === 1 ? "" : "s"}`;

    // Autres écrans (placement/fin) : simple journal chronologique.
    const logHost = root.querySelector<HTMLDivElement>(".orapa-mp__log");
    if (logHost) logHost.innerHTML = history.map((h) => `<div>${h.html}</div>`).join("");
  }

  function setLastAnswer(titleHtml: string, subText: string, colorHex: string | null): void {
    const body = root.querySelector<HTMLDivElement>(".orapa-play__answer-body");
    if (!body) return;
    body.innerHTML = colorHex
      ? `<span class="orapa-play__answer-swatch" style="background:${colorHex}"></span><div><div>${titleHtml}</div><div style="font-size:12px;color:var(--om-text-4);margin-top:2px;">${subText}</div></div>`
      : `<div><div>${titleHtml}</div><div style="font-size:12px;color:var(--om-text-4);margin-top:2px;">${subText}</div></div>`;
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
      if (room?.status === "FINISHED" && phaseHost) renderFinished(phaseHost);
      else updateTurnIndicator();
    });
    ws.on("placement_ack", () => {
      /* la pose optimiste locale a déjà mis à jour l'affichage */
    });
    ws.on("player_ready", (msg) => {
      const id = msg.player_id as string;
      const name = room?.players.find((p) => p.id === id)?.name ?? id;
      pushHistory(`${name} a validé son placement.`);
    });
    ws.on("ray_result", (msg) => {
      const result = msg.result as RayResultPayload;
      const label = msg.entry_label as string;
      const colorName = result.absorbed ? "absorbé" : result.color;
      const hex = hexColor(RAY_COLOR_HEX[colorName] ?? 0x666666);
      pushHistory(describeRay(label, result), hex);
      if (result.absorbed) {
        setLastAnswer("Signal absorbé", `Depuis ${label}`, hex);
      } else {
        const exitLabel = labelForExit(result.exit!, result.exit_direction!);
        setLastAnswer(`Sort en ${exitLabel}`, `Depuis ${label} — ${result.color}`, hex);
      }
      if (scene) {
        // Colore durablement les bornes d'entrée/sortie plutôt que de
        // tracer une ligne éphémère (voir `BoardScene.colorEntryMarker`) :
        // un tracé disparaissait au tir suivant, ce qui compliquait la
        // résolution — retour utilisateur direct. Pour un plateau fixe,
        // une borne ne peut produire qu'une seule couleur, donc les
        // colorer une à une construit une vraie carte des questions
        // déjà posées.
        scene.colorEntryMarker(label, colorName);
        if (!result.absorbed && result.exit) {
          const exitLabel = labelForExit(result.exit, result.exit_direction!);
          scene.colorEntryMarker(exitLabel, result.color);
        }
      }
    });
    ws.on("peek_result", (msg) => {
      const position = msg.position as Position;
      const text = msg.result as string;
      const label = cellLabel(position);
      const colorName = extractPeekColorName(text);
      const hex = colorName ? hexColor(RAY_COLOR_HEX[colorName] ?? 0x666666) : null;
      pushHistory(`Qu'y a-t-il en ${label} ? ${colorizePeekResult(text)}`, hex ?? "var(--om-border)");
      setLastAnswer(text, `En ${label}`, hex);
    });
    ws.on("error", (msg) => {
      // ⚠️ Limite connue (voir docs/plan.md) : une pose optimiste que le
      // serveur rejetterait resterait affichée localement jusqu'au
      // prochain rechargement — pas de rollback ciblé en v1 (pas
      // d'identifiant de requête pour relier l'erreur à la pièce
      // concernée). En pratique, le moteur TS local (`preview-engine.ts`)
      // applique exactement les mêmes règles que le serveur, donc ce
      // cas ne devrait pas se produire hors bug.
      pushHistory(`⚠️ ${msg.message as string}`);
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

function extractPeekColorName(text: string): string | null {
  for (const [word, canonical] of Object.entries(PEEK_COLOR_WORDS)) {
    if (text.endsWith(word)) return canonical;
  }
  return null;
}

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
