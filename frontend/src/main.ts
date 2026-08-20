import "./style.css";
import { mountOrapaMineDemo } from "./games/orapa-mine/demo";
import { mountOrapaMineMultiplayer } from "./games/orapa-mine/multiplayer";

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
    <button type="button" id="try-orapa-mine">Essayer le plateau 3D (démo hors ligne)</button>
    <button type="button" id="play-orapa-mine">Jouer en ligne (créer/rejoindre un salon)</button>
  </div>
  <div id="orapa-mine-root"></div>
`;

const tryButton = app.querySelector<HTMLButtonElement>("#try-orapa-mine");
const playButton = app.querySelector<HTMLButtonElement>("#play-orapa-mine");
const gameRoot = app.querySelector<HTMLDivElement>("#orapa-mine-root");

function disableEntryButtons(): void {
  if (tryButton) tryButton.disabled = true;
  if (playButton) playButton.disabled = true;
}

tryButton?.addEventListener("click", () => {
  if (!gameRoot) return;
  disableEntryButtons();
  mountOrapaMineDemo(gameRoot);
});

playButton?.addEventListener("click", () => {
  if (!gameRoot) return;
  disableEntryButtons();
  mountOrapaMineMultiplayer(gameRoot);
});

// Un lien de salon partagé (?room=CODE) ouvre directement l'écran
// multijoueur, code pré-rempli sur l'onglet "Rejoindre".
if (new URLSearchParams(location.search).has("room") && gameRoot) {
  disableEntryButtons();
  mountOrapaMineMultiplayer(gameRoot);
}
