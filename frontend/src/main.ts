import "./style.css";
import { GAMES, type GameDescriptor, type MountView } from "./games/registry";
import { fetchRoomInfo } from "./lib/rooms";

// Portail multi-jeux (Phase 6 du plan) : la liste de jeux vient de
// `GAMES` — ajouter un jeu n'implique pas de changement ici. Design
// repris de deux maquettes Claude Design (voir claude_design/, non
// versionné) : l'accueil (crème/corail) et Orapa Mine (bleu nuit/or).
// Les deux thèmes sont trop différents pour cohabiter sur un même
// écran : `#app` bascule entièrement de l'un à l'autre (voir
// `renderHome`/`renderGameShell`), au lieu d'empiler l'accueil et
// l'écran de jeu comme avant.
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app introuvable");

type ViewKind = "notice" | "guide" | "try" | "play";
const VIEW_LABELS: Record<ViewKind, string> = {
  notice: "Notice",
  guide: "Guide de jeu",
  try: "Essayer le plateau",
  play: "Jouer en ligne",
};

let disposeCurrentView: (() => void) | null = null;

// --- Accueil ---------------------------------------------------------------

const TICKER_ITEMS = ["Salons par lien", "Pas de compte", "Une partie en quelques secondes", "Jouez entre amis"];

const STEPS = [
  { n: "1", title: "Choisissez un jeu", body: "Un clic sur une tuile ouvre la fiche : règles, guide, et le bouton pour lancer.", color: "var(--am-coral)" },
  { n: "2", title: "Ouvrez un salon", body: "Vous recevez un code de salon. Envoyez-le à qui vous voulez, ou partagez le lien direct.", color: "var(--am-yellow)" },
  { n: "3", title: "Jouez", body: "Tout le monde arrive avec le code, la partie démarre. Rien à installer.", color: "var(--am-green)" },
];

// Jeux à venir : purement décoratifs (pas dans `GAMES`, rien à ouvrir) —
// comme dans la maquette elle-même, qui les affiche déjà "Bientôt".
const STUB_CARDS_HTML = `
  <div class="am-card--stub" style="background: #6c4bf6; color: #f6efe2;">
    <div class="am-card__badge" style="border-color: rgba(246,239,226,.6);">Bientôt</div>
    <h3>Uno</h3>
    <p>Cartes rapides · 2 à 10</p>
  </div>
  <div class="am-card--stub" style="background: #17be8c; color: #10241d;">
    <div class="am-card__badge" style="border-color: rgba(16,36,29,.45);">Bientôt</div>
    <h3>Monopoly</h3>
    <p>Gestion · 2 à 6</p>
  </div>
  <div class="am-card--stub" style="background: #ffc53d; color: #1b1a22;">
    <div class="am-card__badge" style="border-color: rgba(27,26,34,.45);">Bientôt</div>
    <h3>Jeu de dés</h3>
    <p>Hasard · 2 à 8</p>
  </div>
  <div class="am-card--empty">
    <div class="am-card__badge">En chantier</div>
    <div class="am-card--empty__spin"></div>
    <div>
      <h3>Votre jeu ici</h3>
      <p>Dites-nous lequel vous manque.</p>
    </div>
  </div>
`;

// Un seul bouton d'entrée ("Ouvrir le jeu") plutôt qu'un bouton par
// écran : une fois dans le jeu, les 4 écrans (Notice/Guide/Essayer/
// Jouer) restent atteignables via les onglets de `om-shell__tabs` (voir
// `showView` plus bas). "notice" comme écran d'atterrissage par défaut.
function gameCardHtml(game: GameDescriptor): string {
  return `
    <div class="game-card game-card--main" data-game-card="${game.id}">
      <div class="game-card__body">
        <div class="game-card__badge">Jouable</div>
        <h2>${game.title}</h2>
        <p>${game.description}</p>
        <div class="game-card__actions">
          <button type="button" data-game="${game.id}" data-view="notice">Ouvrir le jeu →</button>
        </div>
      </div>
      <div class="game-card__icon" aria-hidden="true">
        <span class="game-card__icon-shape game-card__icon-shape--tri-a"></span>
        <span class="game-card__icon-shape game-card__icon-shape--tri-b"></span>
        <span class="game-card__icon-shape game-card__icon-shape--para"></span>
      </div>
    </div>`;
}

function renderHome(): void {
  if (!app) return;
  disposeCurrentView?.();
  disposeCurrentView = null;
  app.className = "am-home";
  app.innerHTML = `
    <header class="am-header">
      <div class="am-header__brand">
        <div class="am-header__logo"></div>
        <span class="am-header__name">Amusement</span>
      </div>
      <nav class="am-header__nav">
        <button type="button" class="am-header__link" data-scroll="table">Les jeux</button>
        <button type="button" class="am-header__link" data-open-notice>Règles</button>
        <button type="button" class="am-header__cta" data-open-join>Rejoindre avec un code</button>
      </nav>
    </header>

    <section class="am-hero">
      <div class="am-hero__grid">
        <div>
          <h1 class="am-hero__title">Sortez un jeu.<br />Trouvez du monde.<br />Jouez, tout de suite.</h1>
          <p class="am-hero__lede">Une petite table de jeux à partager. Pas de compte, pas d'attente : vous créez un salon, vous envoyez le code, la partie commence.</p>
        </div>
        <div class="am-hero__shapes">
          <div class="am-hero__shape-circle"></div>
          <div class="am-hero__shape-tri"></div>
          <div class="am-hero__shape-square"></div>
        </div>
      </div>
    </section>

    <div class="am-ticker">
      <div class="am-ticker__track">
        <div class="am-ticker__set">${TICKER_ITEMS.map((t) => `<span class="am-ticker__item">${t}</span>`).join("")}</div>
        <div class="am-ticker__set">${TICKER_ITEMS.map((t) => `<span class="am-ticker__item">${t}</span>`).join("")}</div>
      </div>
    </div>

    <div class="am-table-heading" id="table">
      <h2>La table</h2>
      <div class="am-table-heading__meta">${GAMES.length} jeu${GAMES.length > 1 ? "x" : ""} jouable${GAMES.length > 1 ? "s" : ""} · d'autres en préparation</div>
    </div>

    <div class="am-table">
      ${GAMES.map(gameCardHtml).join("\n")}
      ${STUB_CARDS_HTML}
    </div>

    <div class="am-steps">
      ${STEPS.map((s) => `
        <div class="am-step">
          <div class="am-step__n" style="background: ${s.color};">${s.n}</div>
          <div class="am-step__title">${s.title}</div>
          <p>${s.body}</p>
        </div>`).join("")}
    </div>

    <footer class="am-footer">
      <div class="am-footer__inner">
        <div class="am-footer__brand">Amusement</div>
        <div class="am-footer__links">
          <button type="button" class="am-header__link" data-open-notice>Règles</button>
        </div>
      </div>
    </footer>
  `;

  app.querySelector<HTMLButtonElement>("[data-scroll='table']")?.addEventListener("click", () => {
    app.querySelector("#table")?.scrollIntoView({ behavior: "smooth" });
  });
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-open-notice]")) {
    button.addEventListener("click", () => showView(GAMES[0]!.id, "notice"));
  }
  app.querySelector<HTMLButtonElement>("[data-open-join]")?.addEventListener("click", () => showView(GAMES[0]!.id, "play"));

  app.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-game][data-view]");
    if (!button) return;
    showView(button.dataset.game!, button.dataset.view as ViewKind);
  });
}

// --- Coquille de jeu ---------------------------------------------------------

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

// Notice et Guide partagent une fiche (carte "JOUER" + formes
// décoratives à gauche, contenu à onglets à droite — 2 onglets
// seulement, comme la maquette). Essayer/Jouer n'en font pas partie :
// on y accède depuis le bouton "Jouer" (ou le lien secondaire "Essayer
// le plateau", ajout hors maquette pour ne pas perdre cette fonction),
// et ces deux écrans s'affichent seuls, en pleine largeur.
const INFO_VIEWS: ReadonlySet<ViewKind> = new Set(["notice", "guide"]);

function showView(gameId: string, view: ViewKind): void {
  const game = GAMES.find((g) => g.id === gameId);
  if (!app || !game) return;
  disposeCurrentView?.();
  disposeCurrentView = null;

  app.className = "om-shell";
  const isInfoView = INFO_VIEWS.has(view);
  app.innerHTML = `
    <div class="om-shell__header">
      <button type="button" class="om-shell__brand" data-go-home>
        <div class="om-shell__brand-mark"></div>
        <span class="om-shell__brand-name">${game.title.toUpperCase()}</span>
      </button>
      <div class="om-shell__crumbs">
        <button type="button" class="om-shell__back" data-go-home>← Tous les jeux</button>
        <div class="om-shell__crumb">${VIEW_LABELS[view].toUpperCase()}</div>
      </div>
    </div>
    ${
      isInfoView
        ? `
      <div class="om-shell__info-layout">
        <aside class="om-shell__info-card">
          <div class="om-shell__info-card-header">${game.title}</div>
          <div class="om-shell__info-card-icon" aria-hidden="true">
            <span class="game-card__icon-shape game-card__icon-shape--tri-a"></span>
            <span class="game-card__icon-shape game-card__icon-shape--tri-b"></span>
            <span class="game-card__icon-shape game-card__icon-shape--para"></span>
          </div>
          <button type="button" class="om-shell__play-btn" data-view="play">Jouer</button>
          <button type="button" class="om-shell__try-link" data-view="try">Essayer le plateau hors ligne →</button>
          <div class="om-shell__info-tags">
            <span>2 joueurs et +</span>
            <span>~30 min</span>
          </div>
        </aside>
        <div class="om-shell__info-content">
          <div class="om-shell__tabs om-shell__tabs--info">
            <button type="button" data-view="notice" class="${view === "notice" ? "is-selected" : ""}">Notice</button>
            <button type="button" data-view="guide" class="${view === "guide" ? "is-selected" : ""}">Guide de jeu</button>
          </div>
          <div id="view-root"></div>
        </div>
      </div>`
        : `
      <button type="button" class="om-shell__fiche-link" data-view="notice">← Fiche du jeu</button>
      <div id="view-root"></div>`
    }
  `;

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-go-home]")) {
    button.addEventListener("click", renderHome);
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.addEventListener("click", () => showView(gameId, button.dataset.view as ViewKind));
  }

  const viewRoot = app.querySelector<HTMLDivElement>("#view-root")!;
  disposeCurrentView = mountFor(game, view)(viewRoot);
}

renderHome();

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
