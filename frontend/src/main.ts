import "./style.css";
import { mountOrapaMineDemo } from "./games/orapa-mine/demo";
import { mountOrapaMineMultiplayer } from "./games/orapa-mine/multiplayer";
import { mountOrapaMineNotice } from "./pages/notice/orapa-mine";
import { mountOrapaMineGuide } from "./pages/guide/orapa-mine";

// Page d'accueil provisoire du portail multi-jeux (Phase 6 du plan).
// Liste, pour l'instant, uniquement Orapa Mine.
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app introuvable");

app.innerHTML = `
  <h1>Amusement</h1>
  <p>Jeux en ligne entre amis.</p>
  <div class="game-card">
    <h2>Orapa Mine</h2>
    <p>Plateau 3D, mode Duel et mode Fouille.</p>
    <button type="button" id="notice-orapa-mine">Notice (règles)</button>
    <button type="button" id="guide-orapa-mine">Guide de jeu</button>
    <button type="button" id="try-orapa-mine">Essayer le plateau 3D (démo hors ligne)</button>
    <button type="button" id="play-orapa-mine">Jouer en ligne (créer/rejoindre un salon)</button>
  </div>
  <div id="orapa-mine-root"></div>
`;

const entryButtons = {
  notice: app.querySelector<HTMLButtonElement>("#notice-orapa-mine"),
  guide: app.querySelector<HTMLButtonElement>("#guide-orapa-mine"),
  try: app.querySelector<HTMLButtonElement>("#try-orapa-mine"),
  play: app.querySelector<HTMLButtonElement>("#play-orapa-mine"),
};
const gameRoot = app.querySelector<HTMLDivElement>("#orapa-mine-root");

// Une seule vue à la fois dans `gameRoot` : basculer d'un bouton à
// l'autre referme proprement la précédente (ferme la connexion
// WebSocket si "Jouer en ligne" était actif, dispose la scène 3D...)
// plutôt que de bloquer les autres boutons — chacun reste cliquable en
// permanence pour pouvoir naviguer librement entre les sections.
let disposeCurrentView: (() => void) | null = null;

function showView(active: keyof typeof entryButtons, mount: (root: HTMLElement) => () => void): void {
  if (!gameRoot) return;
  disposeCurrentView?.();
  gameRoot.innerHTML = "";
  disposeCurrentView = mount(gameRoot);
  for (const [key, button] of Object.entries(entryButtons)) {
    button?.classList.toggle("is-selected", key === active);
  }
}

entryButtons.notice?.addEventListener("click", () => showView("notice", mountOrapaMineNotice));
entryButtons.guide?.addEventListener("click", () => showView("guide", mountOrapaMineGuide));
entryButtons.try?.addEventListener("click", () => showView("try", mountOrapaMineDemo));
entryButtons.play?.addEventListener("click", () => showView("play", mountOrapaMineMultiplayer));

// Un lien de salon partagé (?room=CODE) ouvre directement l'écran
// multijoueur, code pré-rempli sur l'onglet "Rejoindre".
if (new URLSearchParams(location.search).has("room")) {
  showView("play", mountOrapaMineMultiplayer);
}
