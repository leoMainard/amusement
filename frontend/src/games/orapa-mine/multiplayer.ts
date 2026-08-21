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
import { colorBadgeHtml, colorNameHtml, colorSquareHtml, hexColor } from "./color-swatch";
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
  sendEndTurn,
  sendSubmitSolution,
  sendValidatePlacement,
  sendRemovePiece,
  sendPlacePiece,
} from "./protocol";
import { WS_BASE_URL } from "../../lib/config";
import { RoomSocket } from "../../lib/room-socket";
import { BASE_PIECE_PALETTE, DEFAULT_DIMENSIONS, EXTENSION_PIECE_PALETTE, REFLECTION_UNIT_PALETTE, type Piece, type Position } from "./types";

const MODE_LABELS: Record<RoomMode, string> = {
  DUEL: "Duel (1 contre 1, règles officielles)",
  FOUILLE: "Fouille (plateau généré aléatoirement, tour par tour) — seul ou à plusieurs",
};

const MODE_NAMES: Record<RoomMode, string> = { DUEL: "Duel", FOUILLE: "Fouille" };

// Miroir de `DEFAULT_TURN_DURATION_SECONDS` (amusement.api.game_session) :
// sert seulement à afficher le temps plein pour un joueur dont ce n'est
// pas le tour (voir `renderTimers`) — la vraie échéance vient toujours
// du serveur (`GameStatePayload.turn_deadline`), jamais recalculée
// localement.
const TURN_DURATION_SECONDS = 240;

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
  return [
    ...BASE_PIECE_PALETTE.map((e) => ({ ...e, variant: "gem" as const })),
    ...(extensionsEnabled ? EXTENSION_PIECE_PALETTE.map((e) => ({ ...e, variant: "gem" as const })) : []),
    ...REFLECTION_UNIT_PALETTE.map((e) => ({ ...e, variant: "unit" as const })),
  ];
}

// Puce colorée au-dessus du nom du mode (retour utilisateur direct) —
// mêmes teintes que les gemmes qu'on y associe naturellement : rouge
// (parallélogramme) pour Duel, bleu (triangle) pour Fouille.
const MODE_CHIP_CLASS: Record<RoomMode, string> = {
  DUEL: "orapa-mp__mode-card-chip--duel",
  FOUILLE: "orapa-mp__mode-card-chip--fouille",
};

/** `interactive = false` une fois la partie créée : le mode ne peut
 * plus changer, la carte n'est plus qu'un simple rappel visuel (pas de
 * `data-mode`/écouteur de clic posé dessus). */
function modeCardHtml(mode: RoomMode, selected: RoomMode, interactive: boolean): string {
  const info = MODE_CARD_INFO[mode];
  const isSelected = mode === selected;
  const classes = ["orapa-mp__mode-card", isSelected ? "is-selected" : "", interactive ? "" : "is-locked"].filter(Boolean).join(" ");
  return `
    <button type="button" class="${classes}" ${interactive ? `data-mode="${mode}"` : "disabled"}>
      <span class="orapa-mp__mode-card-chip ${MODE_CHIP_CLASS[mode]}" aria-hidden="true"></span>
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
  let reflectionController: ReflectionController | null = null;
  let playerId = "";
  let room: RoomPayload | null = null;
  let lastGameState: GameStatePayload | null = null;
  // Ré-affiche le compte à rebours chaque seconde tant qu'on est en
  // PLAYING à plusieurs (voir `renderTimers`) — démarré/arrêté par
  // `renderPlaying`/le nettoyage en fin de partie, jamais recalculé côté
  // client : juste un rendu répété de `lastGameState.turn_deadline`.
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  const history: HistoryEntry[] = [];
  // Recalcule l'état désactivé/activé des outils de question (tirer un
  // rayon / interroger une case / proposer) selon le tour — posé par
  // `renderPlaying` (voir plus bas), rappelé à chaque `game_state` reçu
  // (voir `updateTurnIndicator`). `null` en dehors de la phase PLAYING.
  let refreshTurnGating: (() => void) | null = null;

  render();

  function render(): void {
    root.innerHTML = `<div class="orapa-mp"></div>`;
    const host = root.querySelector<HTMLDivElement>(".orapa-mp")!;
    // Le lien "← Fiche du jeu" vit dans le chrome de `main.ts` (au-dessus
    // de `root`, pas rebâti à chaque écran d'ici) : utile pendant la
    // création/le lobby pour changer d'avis, mais superflu — et gênant —
    // une fois vraiment en partie (retour utilisateur direct), d'où ce
    // bascule direct plutôt que de faire remonter l'info à `main.ts`.
    const ficheLink = document.querySelector<HTMLElement>(".om-shell__fiche-link");
    if (!room || room.status === "LOBBY") {
      if (ficheLink) ficheLink.hidden = false;
      renderCreateJoin(host);
    } else {
      if (ficheLink) ficheLink.hidden = true;
      renderGame(host);
    }
  }

  // --- Écrans 1+2 : créer/rejoindre, puis lobby (même panneau) -------------
  // Le panneau "gauche" ne change pas d'identité entre les deux : avant
  // la création, c'est un formulaire ; une fois le salon créé (LOBBY),
  // il devient directement l'affichage du code — pas d'écran séparé à
  // traverser (retour utilisateur direct, calqué sur la maquette).

  function renderCreateJoin(host: HTMLElement): void {
    const prefillCode = new URLSearchParams(location.search).get("room") ?? "";
    let selectedMode: RoomMode = room?.mode ?? "DUEL";
    // Le code n'attend plus le clic sur "Créer et rejoindre" pour
    // apparaître (retour utilisateur direct) : un salon est créé en
    // arrière-plan dès ce premier écran, et re-créé (l'ancien reste
    // simplement inoccupé côté serveur) à chaque changement de mode/
    // joueurs/extensions, puisque l'API n'a pas de "modifier un salon
    // existant". "Créer et rejoindre" ne fait alors que rejoindre ce
    // salon déjà prêt avec le nom choisi.
    let previewCode: string | null = null;
    let previewMaxPlayers = 1;
    let previewExtensions = false;
    let previewGeneration = 0;

    async function refreshPreview(): Promise<void> {
      if (room) return; // déjà réellement rejoint : plus besoin d'aperçu
      const myGeneration = ++previewGeneration;
      try {
        const maxPlayers = selectedMode === "DUEL" ? 2 : previewMaxPlayers;
        const createdRoom = await createRoom(selectedMode, maxPlayers, previewExtensions);
        if (myGeneration !== previewGeneration) return; // une demande plus récente a déjà pris le relais
        previewCode = createdRoom.code;
      } catch {
        if (myGeneration !== previewGeneration) return;
        previewCode = null;
      }
      paint();
    }

    function paint(): void {
      const created = room !== null; // LOBBY : salon réellement rejoint, on attend les joueurs.
      host.innerHTML = `
        <div class="orapa-mp__setup-heading">
          <h1>Créer une partie</h1>
          <p class="orapa-mp__setup-subtitle">Choisissez un mode, invitez vos joueurs avec le code.</p>
        </div>
        <div class="orapa-mp__mode-cards">
          ${modeCardHtml("DUEL", selectedMode, !created)}
          ${modeCardHtml("FOUILLE", selectedMode, !created)}
        </div>
        <div class="orapa-mp__setup">
          <section class="orapa-mp__panel">
            <h3>Code de la partie</h3>
            <button type="button" class="orapa-mp__code" title="Copier le code" ${created || previewCode ? "" : "disabled"}>${created ? room!.code : (previewCode ?? "···")}</button>
            <input type="text" readonly class="orapa-mp__code-fallback" value="${created ? room!.code : (previewCode ?? "")}" />
            ${
              created && room
                ? `
              <div class="orapa-mp__share">
                <input type="text" readonly class="orapa-mp__link" value="${location.origin}${location.pathname}?room=${room.code}" />
                <button type="button" class="orapa-mp__copy">Copier le lien</button>
              </div>
              <p class="orapa-mp__extensions-label">
                ${room.extensions_enabled ? "Extensions activées (Diamant, Corps noir)" : "Extensions désactivées (5 gemmes de base uniquement)"}
              </p>
              <ul class="orapa-mp__players">
                ${room.players.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}
              </ul>
              <p class="orapa-mp__wait-text">${room.players.length}/${room.max_players} joueur${room.max_players > 1 ? "s" : ""} — en attente...</p>
              <button type="button" class="orapa-mp__launch-btn" disabled>Lancer · ${MODE_NAMES[room.mode]}</button>
            `
                : `
              <label>Ton nom <input type="text" class="orapa-mp__create-name" value="Joueur 1" /></label>
              <label class="orapa-mp__max-players" ${selectedMode === "DUEL" ? "hidden" : ""}>
                Nombre de joueurs <span class="orapa-mp__max-players-value">${previewMaxPlayers}</span>
                <input type="range" class="orapa-mp__max-players-input" min="1" max="5" value="${previewMaxPlayers}" />
              </label>
              <p class="orapa-mp__max-players-hint" ${selectedMode === "DUEL" ? "hidden" : ""}>1 joueur : tu joues seul.</p>
              <label class="orapa-mp__extensions">
                <input type="checkbox" class="orapa-mp__extensions-input" ${previewExtensions ? "checked" : ""} />
                Autoriser les pièces d'extension (Diamant, Corps noir)
              </label>
              <p class="orapa-mp__extensions-hint">
                Fixé pour tout le salon : les deux joueurs auront (ou non) accès à ces pièces en plus des 5 de base.
              </p>
              <button type="button" class="orapa-mp__create-btn" ${previewCode ? "" : "disabled"}>Créer et rejoindre</button>
            `
            }
          </section>
          ${
            created
              ? ""
              : `
          <section class="orapa-mp__panel">
            <h3>Rejoindre une partie</h3>
            <label>Ton nom <input type="text" class="orapa-mp__join-name" value="Joueur 2" /></label>
            <label>Code du salon <input type="text" class="orapa-mp__join-code" value="${prefillCode}" maxlength="5" /></label>
            <button type="button" class="orapa-mp__join-btn">Rejoindre</button>
            <p class="orapa-mp__extensions-hint">Le code t'est donné par l'hôte de la partie.</p>
          </section>`
          }
        </div>
        <p class="orapa-mp__error" aria-live="polite"></p>
      `;

      if (!created) {
        for (const card of host.querySelectorAll<HTMLButtonElement>(".orapa-mp__mode-card")) {
          card.addEventListener("click", () => {
            if (selectedMode === card.dataset.mode) return;
            selectedMode = card.dataset.mode as RoomMode;
            previewCode = null;
            paint();
            refreshPreview();
          });
        }
      }

      const errorHost = host.querySelector<HTMLParagraphElement>(".orapa-mp__error")!;

      // Le code (aperçu ou réel une fois rejoint) est toujours cliquable
      // pour le copier — `codeFallbackInput` (invisible) sert seulement
      // de cible de secours à `copyToClipboard` si `navigator.clipboard`
      // est indisponible (voir sa docstring).
      const codeButton = host.querySelector<HTMLButtonElement>(".orapa-mp__code")!;
      const codeFallbackInput = host.querySelector<HTMLInputElement>(".orapa-mp__code-fallback")!;
      const currentCode = created && room ? room.code : previewCode;
      if (currentCode) {
        const originalCodeLabel = codeButton.textContent ?? currentCode;
        codeButton.addEventListener("click", async () => {
          const copied = await copyToClipboard(currentCode, codeFallbackInput);
          codeButton.textContent = copied ? "Copié !" : originalCodeLabel;
          setTimeout(() => {
            codeButton.textContent = originalCodeLabel;
          }, 2000);
        });
      }

      if (created && room) {
        const link = `${location.origin}${location.pathname}?room=${room.code}`;
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
        return;
      }

      const maxPlayersInput = host.querySelector<HTMLInputElement>(".orapa-mp__max-players-input")!;
      const maxPlayersValue = host.querySelector<HTMLSpanElement>(".orapa-mp__max-players-value")!;
      maxPlayersInput.addEventListener("input", () => {
        maxPlayersValue.textContent = maxPlayersInput.value;
      });
      maxPlayersInput.addEventListener("change", () => {
        previewMaxPlayers = Number(maxPlayersInput.value) || 1;
        previewCode = null;
        paint();
        refreshPreview();
      });
      const extensionsInput = host.querySelector<HTMLInputElement>(".orapa-mp__extensions-input")!;
      extensionsInput.addEventListener("change", () => {
        previewExtensions = extensionsInput.checked;
        previewCode = null;
        paint();
        refreshPreview();
      });

      host.querySelector<HTMLButtonElement>(".orapa-mp__create-btn")!.addEventListener("click", async () => {
        errorHost.textContent = "";
        const name = host.querySelector<HTMLInputElement>(".orapa-mp__create-name")!.value.trim() || "Joueur";
        if (previewCode) {
          try {
            await connect(previewCode, name);
          } catch (error) {
            errorHost.textContent = error instanceof Error ? error.message : String(error);
          }
          return;
        }
        // Repli si l'aperçu n'a pas pu être généré (ex : coupure réseau) :
        // on retente une création classique, en une fois.
        try {
          const maxPlayers = selectedMode === "DUEL" ? 2 : previewMaxPlayers;
          const createdRoom = await createRoom(selectedMode, maxPlayers, extensionsInput.checked);
          await connect(createdRoom.code, name);
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
    refreshPreview();
  }

  async function connect(code: string, name: string): Promise<void> {
    const ws = new RoomSocket(`${WS_BASE_URL}/ws/rooms/${code}?name=${encodeURIComponent(name)}`);
    await ws.ready();
    socket = ws;
    wireSocket(ws);
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
            <div class="orapa-play__timers" hidden></div>
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

              <div class="orapa-play__notes">
                <span class="om-eyebrow">Carnet</span>
                <textarea class="orapa-mp__notepad" placeholder="Note ce que tu veux ici — déductions, cases à retenir..."></textarea>
              </div>
            </div>

            <div class="orapa-play__center">
              <div class="orapa-play__canvas"></div>

              <div class="orapa-play__toggles">
                <button type="button" class="orapa-mp__mark-toggle">✕ Marquer des cases</button>
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

              <button type="button" class="orapa-play__end-turn-btn" hidden>Terminer mon tour</button>
            </div>

            <div class="orapa-play__side orapa-play__side--ask">
              <div class="orapa-mp__reflect-panel">
                <div class="orapa-mp__reflect-head">
                  <span class="om-eyebrow">Placer des repères</span>
                </div>
                <p class="orapa-demo__hint">Hypothèses personnelles, jamais transmises à l'adversaire — reclique un repère posé pour le retirer.</p>
                <div class="orapa-demo__group orapa-demo__group--preview">
                  <span class="om-eyebrow">Aperçu</span>
                  <div class="orapa-place__preview-box"></div>
                  <div class="orapa-demo__transform">
                    <button type="button" class="orapa-demo__rotate">⟳ Pivoter 90°</button>
                    <button type="button" class="orapa-demo__mirror">⇋ Retourner</button>
                  </div>
                </div>
                <div class="orapa-mp__reflect-palette"></div>
                <button type="button" class="orapa-mp__reflect-clear">Vider le plateau</button>
                <p class="orapa-demo__result orapa-mp__reflect-status" aria-live="polite"></p>
              </div>

              <div class="orapa-play__propose-block">
                <p class="orapa-play__propose-hint">
                  Positionne tes 5 gemmes avec « Placer des repères » ci-dessus, puis propose cette
                  disposition — inutile de tout replacer ailleurs.
                </p>
                <button type="button" class="orapa-play__propose">Proposer la disposition</button>
                <p class="orapa-play__propose-status" aria-live="polite"></p>
              </div>
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
      // La scène est réutilisée d'une phase à l'autre (voir `attachTo`
      // ci-dessus) : sans ce vidage, les gemmes qu'on vient de poser
      // pendant PLACING restaient visibles pendant PLAYING (retour
      // utilisateur direct — on ne doit plus voir ses propres gemmes une
      // fois la partie commencée, seulement les repères qu'on choisit
      // d'y poser).
      scene.setPieces([]);
      setUpNotepad(host.querySelector<HTMLTextAreaElement>(".orapa-mp__notepad")!);
      renderHistory();
      renderPlaying(host);
      updateTurnIndicator();
      // Ré-affiche le compte à rebours chaque seconde (voir
      // `renderTimers`) — l'écran PLAYING peut être reconstruit plusieurs
      // fois (ex. `room_update` si un joueur se reconnecte) : on repart
      // toujours d'un seul intervalle propre, jamais empilés.
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(renderTimers, 1000);
      const helpDialog = mountHelpDialog(host);
      host.querySelector<HTMLButtonElement>(".orapa-play__help-btn")!.addEventListener("click", () => helpDialog.open());
      return;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // PLACING / FINISHED : mise en page canvas + panneau latéral. Pas de
    // bloc-notes pendant PLACING (retour utilisateur direct — inutile
    // tant qu'on ne fait que poser ses propres gemmes, rien à déduire
    // encore) ; il réapparaît en FINISHED comme avant.
    host.innerHTML = `
      <div class="orapa-demo">
        <div class="orapa-demo__canvas"></div>
        <aside class="orapa-demo__panel">
          <div class="orapa-demo__panel-head">
            <h3>Salon ${room.code} — ${MODE_LABELS[room.mode]}</h3>
            <button type="button" class="om-help-btn orapa-mp__help-btn">❔ Aide</button>
          </div>
          <div class="orapa-mp__phase"></div>
          <div class="orapa-mp__game-controls"></div>
          <div class="orapa-demo__result orapa-mp__log" aria-live="polite"></div>
          ${
            room.status === "PLACING"
              ? ""
              : `
          <details class="orapa-mp__notepad-block">
            <summary>Bloc-notes (personnel, non partagé)</summary>
            <textarea class="orapa-mp__notepad" placeholder="Note ce que tu veux ici — déductions, cases à retenir..."></textarea>
          </details>`
          }
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
    const notepadEl = host.querySelector<HTMLTextAreaElement>(".orapa-mp__notepad");
    if (notepadEl) setUpNotepad(notepadEl);
    renderHistory();
    const placingHelpDialog = mountHelpDialog(host);
    host.querySelector<HTMLButtonElement>(".orapa-mp__help-btn")!.addEventListener("click", () => placingHelpDialog.open());

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
      <div class="orapa-demo__group orapa-demo__group--preview">
        <span class="om-eyebrow">Aperçu</span>
        <div class="orapa-place__preview-box"></div>
        <div class="orapa-demo__transform">
          <button type="button" class="orapa-demo__rotate">⟳ Pivoter (R)</button>
          <button type="button" class="orapa-demo__mirror">⇋ Retourner (F)</button>
        </div>
      </div>
      <div class="orapa-demo__group orapa-demo__group--gems">
        <span class="om-eyebrow">Vos gemmes</span>
        <div class="orapa-demo__palette"></div>
      </div>
      <div class="orapa-demo__bulk-actions">
        <button type="button" class="orapa-demo__bulk-clear">Tout retirer</button>
        <button type="button" class="orapa-demo__bulk-random">Au hasard</button>
      </div>
      <button type="button" class="orapa-demo__validate" disabled>Je suis prêt (0/5)</button>
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
      // "Je suis prêt" plutôt que "Valider le placement" en Duel (retour
      // utilisateur direct) : `renderPlacing` n'est appelé que pour ce
      // mode, PLACING n'existant pas côté serveur pour Fouille (plateau
      // généré, pas de pose manuelle — voir rooms/room.py).
      validateLabel: "Je suis prêt",
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
    const markToggle = host.querySelector<HTMLButtonElement>(".orapa-mp__mark-toggle")!;
    const reflectPanel = host.querySelector<HTMLDivElement>(".orapa-mp__reflect-panel")!;
    const entryInput = host.querySelector<HTMLInputElement>(".orapa-play__entry-input")!;
    const fireBtn = host.querySelector<HTMLButtonElement>(".orapa-play__fire-btn")!;
    const targetLabelEl = host.querySelector<HTMLDivElement>(".orapa-play__target-label")!;
    const askBtn = host.querySelector<HTMLButtonElement>(".orapa-play__ask-btn")!;
    const proposeBtn = host.querySelector<HTMLButtonElement>(".orapa-play__propose")!;
    const proposeStatus = host.querySelector<HTMLParagraphElement>(".orapa-play__propose-status")!;
    const endTurnBtn = host.querySelector<HTMLButtonElement>(".orapa-play__end-turn-btn")!;
    // Chrono/bouton "Terminer mon tour" seulement à plusieurs (voir
    // `renderTimers` — même condition que le chrono côté serveur,
    // `OrapaMineSession.turn_deadline`) : personne à presser tout seul.
    endTurnBtn.hidden = (room?.players.length ?? 0) <= 1;

    // "Placer des repères" reste affiché en permanence désormais (plus
    // de bouton pour l'activer, retour utilisateur direct) : un simple
    // clic sur le plateau sert donc, dans l'ordre, à retirer/poser un
    // repère si une pièce est armée (voir `ReflectionController.handleClick`),
    // sinon à basculer une croix si "Marquer des cases" est actif, sinon
    // à sélectionner une cible pour "Interroger une case" (le vrai envoi
    // passe par "Demander", jamais un clic seul — corrige un vrai bug où
    // faire tourner la vue à la souris pouvait, en fin de rotation, poser
    // à tort une question sur la case survolée).
    let markMode = false;
    let askTarget: Position | null = null;

    // Tirer un rayon / interroger une case / proposer une disposition
    // ne sont plus seulement refusés après coup (message d'avertissement) :
    // ils sont directement désactivés hors de son tour (retour
    // utilisateur direct). "Marquer"/"Placer des repères" restent
    // toujours actifs : outils personnels, jamais envoyés à l'adversaire.
    const refreshGating = () => {
      const myTurn = isMyTurn();
      fireBtn.disabled = !myTurn;
      entryInput.disabled = !myTurn;
      askBtn.disabled = !myTurn || !askTarget;
      proposeBtn.disabled = !myTurn;
      endTurnBtn.disabled = !myTurn;
    };
    refreshTurnGating = refreshGating;

    endTurnBtn.addEventListener("click", () => {
      if (!isMyTurn()) return;
      sendEndTurn(socket!);
    });

    if (scene) {
      reflectionController?.dispose();
      reflectionController = new ReflectionController({
        scene,
        paletteHost: reflectPanel.querySelector(".orapa-mp__reflect-palette")!,
        previewHost: reflectPanel.querySelector(".orapa-place__preview-box")!,
        rotateButton: reflectPanel.querySelector(".orapa-demo__rotate")!,
        mirrorButton: reflectPanel.querySelector(".orapa-demo__mirror")!,
        clearButton: reflectPanel.querySelector(".orapa-mp__reflect-clear")!,
        statusHost: reflectPanel.querySelector(".orapa-mp__reflect-status")!,
        entries: reflectionEntries(room?.extensions_enabled ?? false),
      });
      scene.onCornerClick = ({ corner }) => {
        if (markMode) {
          // Marquer une case ne dépend jamais du tour : outil personnel,
          // pas une question posée à l'adversaire.
          scene!.toggleMark(corner);
          return;
        }
        if (reflectionController!.handleClick(corner)) return;
        askTarget = corner;
        targetLabelEl.textContent = cellLabel(corner);
        refreshGating();
      };
    }

    markToggle.addEventListener("click", () => {
      markMode = !markMode;
      markToggle.classList.toggle("is-selected", markMode);
    });

    // "Proposer la disposition" ne rouvre plus un plateau à repositionner
    // de zéro : elle reprend directement les repères (gemmes complètes,
    // voir `reflection-controller.ts`) déjà posés par le joueur en
    // "🧩 Placer des repères" (retour utilisateur direct — poser deux
    // fois les mêmes pièces n'avait aucun sens). S'il manque une des 5
    // gemmes de base parmi ces repères, la proposition est refusée avec
    // un message plutôt qu'envoyée incomplète.
    proposeBtn.addEventListener("click", () => {
      if (!isMyTurn()) {
        proposeStatus.textContent = "⚠️ Ce n'est pas ton tour.";
        return;
      }
      const placed = reflectionController?.board.pieces() ?? [];
      const matched = new Map<string, Piece>();
      for (const piece of placed) {
        const entry = BASE_PIECE_PALETTE.find((e) => e.shape === piece.shape && e.color === piece.color);
        if (entry && !matched.has(entry.label)) matched.set(entry.label, piece);
      }
      const missing = BASE_PIECE_PALETTE.filter((entry) => !matched.has(entry.label));
      if (missing.length > 0) {
        proposeStatus.textContent = `Il manque des gemmes à positionner parmi tes repères : ${missing.map((e) => e.label).join(", ")}.`;
        return;
      }
      proposeStatus.textContent = "Proposition envoyée...";
      const guess = BASE_PIECE_PALETTE.map((entry) => matched.get(entry.label)!);
      sendSubmitSolution(socket!, guess);
    });

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
      refreshGating();
    });

    refreshGating();
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
    if (el && room) {
      const state = lastGameState;
      const turnPlayer = state ? (room.mode === "DUEL" ? state.current_prospector : state.current_turn_player) : null;
      if (turnPlayer === playerId) {
        el.textContent = "À toi de jouer.";
      } else if (turnPlayer) {
        const name = room.players.find((p) => p.id === turnPlayer)?.name ?? turnPlayer;
        el.textContent = `Au tour de ${name}.`;
      } else {
        el.textContent = "";
      }
    }
    renderTimers();
    refreshTurnGating?.();
  }

  /** Chronos "Vous"/adversaire(s) du bandeau du haut (retour utilisateur
   * direct : "chaque tour dure 4 min... vous avec un point vert, et
   * adversaire avec un point bleu") — seulement à plusieurs (voir
   * `OrapaMineSession.turn_deadline` côté serveur : personne à presser
   * tout seul). Remplace le texte "À toi de jouer"/"Au tour de X" plutôt
   * que de le doubler. N'affiche un compte à rebours qui défile que pour
   * le joueur dont c'est VRAIMENT le tour ; les autres montrent le temps
   * plein "4:00", en attente du leur. */
  function renderTimers(): void {
    const host = root.querySelector<HTMLDivElement>(".orapa-play__timers");
    const turnEl = root.querySelector<HTMLParagraphElement>(".orapa-mp__turn");
    if (!host || !room) return;
    const multiplayer = room.players.length > 1;
    if (turnEl) turnEl.hidden = multiplayer;
    host.hidden = !multiplayer;
    if (!multiplayer) return;

    const state = lastGameState;
    const turnPlayerId = state ? (room.mode === "DUEL" ? state.current_prospector : state.current_turn_player) : null;
    const deadline = state?.turn_deadline;
    const remaining = deadline != null ? deadline - Date.now() / 1000 : TURN_DURATION_SECONDS;

    const rows: string[] = [
      timerRowHtml("Vous", "you", turnPlayerId === playerId, remaining),
      ...room.players.filter((p) => p.id !== playerId).map((p) => timerRowHtml(p.name, "opponent", turnPlayerId === p.id, remaining)),
    ];
    host.innerHTML = rows.join("");
  }

  function timerRowHtml(name: string, kind: "you" | "opponent", active: boolean, remaining: number): string {
    const time = formatCountdown(active ? remaining : TURN_DURATION_SECONDS);
    return `
      <span class="orapa-play__timer${active ? " is-active" : ""}">
        <span class="orapa-play__timer-dot orapa-play__timer-dot--${kind}"></span>
        ${escapeHtml(name)} <span class="orapa-play__timer-time">${time}</span>
      </span>
    `;
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
    if (timerInterval) clearInterval(timerInterval);
    socket?.close();
    scene?.dispose();
    placementController?.dispose();
    reflectionController?.dispose();
  };
}

// Texte de l'historique simplifié au maximum (retour utilisateur
// direct — l'ancienne phrase complète "Rayon depuis X : sort en Y —
// couleur [pastille]." était trop verbeuse) : "ENTRÉE Rayon → sortie
// SORTIE [case colorée] COULEUR".
function describeRay(label: string, result: RayResultPayload): string {
  if (result.absorbed) return `<strong>${label}</strong> Rayon → absorbé`;
  const exitLabel = labelForExit(result.exit!, result.exit_direction!);
  return `<strong>${label}</strong> Rayon → sortie <strong>${exitLabel}</strong> ${colorSquareHtml(result.color)}${colorNameHtml(result.color)}`;
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
