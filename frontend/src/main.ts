import "./style.css";
import { GAMES, type GameDescriptor, type MountView } from "./games/registry";
import { fetchRoomInfo } from "./lib/rooms";

// Portail multi-jeux (Phase 6 du plan) : la page d'accueil se construit
// entièrement à partir de `GAMES` (voir games/registry.ts) — ajouter un
// jeu n'implique aucun changement ici.
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app introuvable");

type ViewKind = "notice" | "guide" | "try" | "play";
const VIEW_LABELS: Record<ViewKind, string> = {
  notice: "Notice (règles)",
  guide: "Guide de jeu",
  try: "Essayer le plateau 3D (démo hors ligne)",
  play: "Jouer en ligne (créer/rejoindre un salon)",
};

function gameCardHtml(game: GameDescriptor): string {
  const buttons = (Object.keys(VIEW_LABELS) as ViewKind[])
    .map((view) => `<button type="button" data-game="${game.id}" data-view="${view}">${VIEW_LABELS[view]}</button>`)
    .join("\n    ");
  return `
    <div class="game-card" data-game-card="${game.id}">
      <h2>${game.title}</h2>
      <p>${game.description}</p>
      ${buttons}
    </div>`;
}

app.innerHTML = `
  <h1>Amusement</h1>
  <p>Jeux en ligne entre amis.</p>
  ${GAMES.map(gameCardHtml).join("\n")}
  <div id="view-root"></div>
`;

const viewRoot = app.querySelector<HTMLDivElement>("#view-root");

// Une seule vue à la fois dans `viewRoot` : basculer d'un bouton à
// l'autre referme proprement la précédente (ferme la connexion
// WebSocket si "Jouer en ligne" était actif, dispose la scène 3D...)
// plutôt que de bloquer les autres boutons — chacun reste cliquable en
// permanence pour pouvoir naviguer librement entre les sections, y
// compris entre deux jeux différents.
let disposeCurrentView: (() => void) | null = null;

function mountFor(game: GameDescriptor, view: ViewKind): MountView {
  switch (view) {
    case "notice":
      return game.mountNotice;
    case "guide":
      return game.mountGuide;
    case "try":
      return game.mountDemo;
    case "play":
      return game.mountMultiplayer;
  }
}

function showView(gameId: string, view: ViewKind): void {
  const game = GAMES.find((g) => g.id === gameId);
  if (!game || !viewRoot) return;
  disposeCurrentView?.();
  viewRoot.innerHTML = "";
  disposeCurrentView = mountFor(game, view)(viewRoot);
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-game][data-view]")) {
    const isActive = button.dataset.game === gameId && button.dataset.view === view;
    button.classList.toggle("is-selected", isActive);
  }
}

app.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-game][data-view]");
  if (!button) return;
  showView(button.dataset.game!, button.dataset.view as ViewKind);
});

// Un lien de salon partagé (?room=CODE) ouvre directement l'écran
// multijoueur du bon jeu (résolu via l'API — le code seul ne dit rien
// du jeu concerné), code pré-rempli sur l'onglet "Rejoindre" (géré par
// l'écran multijoueur lui-même, qui relit `location.search`).
const sharedRoomCode = new URLSearchParams(location.search).get("room");
if (sharedRoomCode) {
  fetchRoomInfo(sharedRoomCode).then((info) => {
    const gameId = info?.game ?? GAMES[0]?.id;
    if (gameId) showView(gameId, "play");
  });
}
