/**
 * Bulle de discussion entre joueurs (retour utilisateur direct — "je
 * souhaite qu'il y'ait un chat entre joueurs... positionné en bas à
 * droite via une petite bulle"). Un seul widget, monté une fois par
 * partie de `mountOrapaMineMultiplayer` et rattaché à `document.body`
 * (pas à `root` : celui-ci est entièrement reconstruit à chaque écran —
 * lobby, placement, jeu, résultats — voir `render()`/`renderGame()`,
 * alors que la discussion doit leur survivre tant que le salon reste le
 * même). Ne connaît rien du protocole WebSocket lui-même : `onSend`/
 * `onTyping` remontent l'intention, `addMessage`/`showTyping` reçoivent
 * ce que le serveur a diffusé — voir `wireSocket` dans `multiplayer.ts`.
 */

import type { ChatMessagePayload } from "./protocol";

// Repris tel quel de `multiplayer.ts` (pas d'utilitaire partagé dans ce
// projet pour une fonction aussi minime) — voir sa propre docstring.
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Quelques réactions rapides (retour utilisateur direct — "ajoute tout
// ce qui peut être utile à un chat, pour le rendre ludique et
// satisfaisant") : un clic les envoie directement, sans passer par le
// champ de texte — pratique en pleine partie, une main sur la souris.
const QUICK_PHRASES = ["👍", "😂", "🔥", "🤔", "😮", "Bien joué !", "Beau coup !", "GG"];

// Le serveur tronque déjà à 300 caractères (voir `game_ws.py`) — la
// limite ici n'est qu'un confort d'affichage, pas une vraie garantie.
const MAX_MESSAGE_LENGTH = 300;
// Le serveur ne fait que retransmettre (voir `game_ws.py:chat_typing`,
// sans état conservé) : c'est ce client qui décide combien de temps
// garder l'indicateur affiché sans nouvel envoi de l'autre joueur.
const TYPING_INDICATOR_TIMEOUT_MS = 3000;
// Pas la peine de spammer le serveur à chaque frappe : un envoi au plus
// toutes les X ms suffit à garder l'indicateur vivant côté adversaire
// (voir `TYPING_INDICATOR_TIMEOUT_MS`, nettement plus long).
const TYPING_SEND_THROTTLE_MS = 1500;

export interface ChatWidgetOptions {
  onSend: (text: string) => void;
  onTyping: () => void;
}

export class ChatWidget {
  private root: HTMLDivElement;
  private bubble: HTMLButtonElement;
  private badge: HTMLSpanElement;
  private panel: HTMLDivElement;
  private messagesHost: HTMLDivElement;
  private typingHost: HTMLDivElement;
  private input: HTMLInputElement;

  private messages: ChatMessagePayload[] = [];
  private unread = 0;
  private isOpen = false;
  private myPlayerId = "";
  private typingClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTypingSentAt = 0;
  // Créé au premier geste utilisateur (ouvrir la bulle ou envoyer un
  // message) — jamais avant, les navigateurs refusent un `AudioContext`
  // démarré sans interaction (retour utilisateur direct : le petit son
  // d'arrivée de message ne doit rien casser silencieusement).
  private audioCtx: AudioContext | null = null;
  private options: ChatWidgetOptions;

  constructor(options: ChatWidgetOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "orapa-chat";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="orapa-chat__panel" hidden>
        <div class="orapa-chat__header">
          <span>Discussion</span>
          <button type="button" class="orapa-chat__close" title="Fermer" aria-label="Fermer la discussion">✕</button>
        </div>
        <div class="orapa-chat__messages"></div>
        <p class="orapa-chat__typing" hidden></p>
        <div class="orapa-chat__quick"></div>
        <form class="orapa-chat__form">
          <input type="text" class="orapa-chat__input" placeholder="Écrire un message..." maxlength="${MAX_MESSAGE_LENGTH}" autocomplete="off" />
          <button type="submit" class="orapa-chat__send" title="Envoyer" aria-label="Envoyer">➤</button>
        </form>
      </div>
      <button type="button" class="orapa-chat__bubble" title="Discussion" aria-label="Ouvrir la discussion">
        💬
        <span class="orapa-chat__badge" hidden>0</span>
      </button>
    `;
    document.body.appendChild(this.root);

    this.bubble = this.root.querySelector(".orapa-chat__bubble")!;
    this.badge = this.root.querySelector(".orapa-chat__badge")!;
    this.panel = this.root.querySelector(".orapa-chat__panel")!;
    this.messagesHost = this.root.querySelector(".orapa-chat__messages")!;
    this.typingHost = this.root.querySelector(".orapa-chat__typing")!;
    this.input = this.root.querySelector(".orapa-chat__input")!;

    const quickHost = this.root.querySelector<HTMLDivElement>(".orapa-chat__quick")!;
    for (const phrase of QUICK_PHRASES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "orapa-chat__chip";
      chip.textContent = phrase;
      chip.addEventListener("click", () => this.send(phrase));
      quickHost.appendChild(chip);
    }

    this.bubble.addEventListener("click", () => (this.isOpen ? this.close() : this.openPanel()));
    this.root.querySelector(".orapa-chat__close")!.addEventListener("click", () => this.close());
    this.root.querySelector(".orapa-chat__form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send(this.input.value);
    });
    this.input.addEventListener("input", () => {
      const now = Date.now();
      if (now - this.lastTypingSentAt < TYPING_SEND_THROTTLE_MS) return;
      this.lastTypingSentAt = now;
      this.options.onTyping();
    });
  }

  setPlayerId(id: string): void {
    this.myPlayerId = id;
  }

  /** Une fois dans un salon (retour utilisateur direct — inutile avant,
   * personne à qui parler). */
  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.close();
  }

  /** Nouvelle partie/salon (bouton "Rejouer") — repart d'une discussion
   * vide plutôt que de garder celle de la partie précédente. */
  reset(): void {
    this.messages = [];
    this.unread = 0;
    this.updateBadge();
    this.messagesHost.innerHTML = "";
    this.hideTyping();
  }

  addMessage(message: ChatMessagePayload): void {
    this.messages.push(message);
    this.renderMessage(message);
    this.messagesHost.scrollTop = this.messagesHost.scrollHeight;
    // Un message de l'adversaire referme forcément son indicateur "en
    // train d'écrire" (il vient justement de finir).
    if (message.player_id !== this.myPlayerId) this.hideTyping();
    if (this.isOpen) return;
    this.unread++;
    this.updateBadge();
    this.bounceBubble();
    if (message.player_id !== this.myPlayerId) this.playChime();
  }

  showTyping(playerName: string): void {
    this.typingHost.hidden = false;
    this.typingHost.textContent = `${playerName} est en train d'écrire...`;
    if (this.typingClearTimeout) clearTimeout(this.typingClearTimeout);
    this.typingClearTimeout = setTimeout(() => this.hideTyping(), TYPING_INDICATOR_TIMEOUT_MS);
  }

  dispose(): void {
    if (this.typingClearTimeout) clearTimeout(this.typingClearTimeout);
    this.audioCtx?.close().catch(() => {});
    this.root.remove();
  }

  private hideTyping(): void {
    if (this.typingClearTimeout) clearTimeout(this.typingClearTimeout);
    this.typingClearTimeout = null;
    this.typingHost.hidden = true;
  }

  private openPanel(): void {
    this.isOpen = true;
    this.panel.hidden = false;
    this.bubble.classList.add("is-open");
    this.unread = 0;
    this.updateBadge();
    this.ensureAudio();
    this.messagesHost.scrollTop = this.messagesHost.scrollHeight;
    this.input.focus();
  }

  private close(): void {
    this.isOpen = false;
    this.panel.hidden = true;
    this.bubble.classList.remove("is-open");
  }

  private send(rawText: string): void {
    const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return;
    this.ensureAudio();
    this.options.onSend(text);
    this.input.value = "";
  }

  private renderMessage(message: ChatMessagePayload): void {
    const isMine = message.player_id === this.myPlayerId;
    const time = new Date(message.at * 1000);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const row = document.createElement("div");
    row.className = `orapa-chat__message ${isMine ? "is-mine" : "is-other"}`;
    row.innerHTML = `
      ${isMine ? "" : `<span class="orapa-chat__message-name">${escapeHtml(message.player_name)}</span>`}
      <span class="orapa-chat__message-bubble">${escapeHtml(message.text)}</span>
      <span class="orapa-chat__message-time">${hh}:${mm}</span>
    `;
    this.messagesHost.appendChild(row);
  }

  private updateBadge(): void {
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
  }

  private bounceBubble(): void {
    this.bubble.classList.remove("orapa-chat__bubble--bounce");
    // Force un reflow pour pouvoir rejouer l'animation même si la classe
    // vient d'être retirée à l'instant (sinon le navigateur la considère
    // inchangée et ne la rejoue pas) — même technique que la révélation
    // des résultats, en plus explicite ici puisque l'élément n'est pas
    // recréé (voir `renderResultsPieceList` dans `multiplayer.ts`, qui
    // s'appuie lui sur des nœuds toujours neufs).
    void this.bubble.offsetWidth;
    this.bubble.classList.add("orapa-chat__bubble--bounce");
  }

  /** Petit "pop" synthétisé (Web Audio, aucun fichier à charger) à
   * l'arrivée d'un message alors que le panneau est fermé — retour
   * utilisateur direct : "tout ce qui peut être utile... pour le rendre
   * ludique et satisfaisant". Silencieux si le navigateur refuse (voir
   * `ensureAudio`, jamais démarré sans geste préalable). */
  private playChime(): void {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private ensureAudio(): void {
    if (this.audioCtx) {
      if (this.audioCtx.state === "suspended") this.audioCtx.resume().catch(() => {});
      return;
    }
    try {
      this.audioCtx = new AudioContext();
    } catch {
      // Contexte audio indisponible (navigateur/permissions) — le chat
      // reste utilisable sans son, purement décoratif.
    }
  }
}
