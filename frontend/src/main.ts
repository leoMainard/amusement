import "./style.css";
import { mountOrapaMineDemo } from "./games/orapa-mine/demo";

// Page d'accueil provisoire du portail multi-jeux (Phase 6 du plan).
// Liste, pour l'instant, uniquement Orapa Mine.
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app introuvable");

app.innerHTML = `
  <h1>Amusement</h1>
  <p>Jeux en ligne entre amis.</p>
  <div class="game-card">
    <h2>Orapa Mine</h2>
    <p>Plateau 3D, mode Duel et mode Fouille — en cours de construction.</p>
    <button type="button" id="try-orapa-mine">Essayer le plateau 3D (démo hors ligne)</button>
  </div>
  <div id="orapa-mine-demo-root"></div>
`;

const tryButton = app.querySelector<HTMLButtonElement>("#try-orapa-mine");
const demoRoot = app.querySelector<HTMLDivElement>("#orapa-mine-demo-root");
tryButton?.addEventListener("click", () => {
  if (!demoRoot) return;
  tryButton.disabled = true;
  mountOrapaMineDemo(demoRoot);
});
