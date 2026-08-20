# Plan — Amusement

Site de jeux en ligne entre amis. Premier jeu : **Orapa Mine**.

## Décisions prises

- **Stack** : backend Python (FastAPI + WebSockets) dans `src/amusement/`,
  frontend TypeScript + Three.js dans `frontend/`.
- **Salons** : par lien, sans compte utilisateur (v1).
- **Mode Fouille** (placement aléatoire) : proposé avec deux variantes au
  choix à la création du salon :
  - *parallèle privé* : chaque joueur interroge sa propre instance du
    plateau caché (même génération pour tous), sans voir les questions
    des autres ; premier à soumettre une solution complète et correcte
    gagne ;
  - *tour par tour* : un plateau commun, questions/réponses visibles de
    tous, tour par tour ; premier à trouver la solution complète gagne.
- **Mode Duel** (officiel) : placement secret par chaque joueur,
  alternance maître du jeu / prospecteur, exactement comme dans le
  livret, mais sur plateau 3D.
- Aucun asset ni texte du livret officiel n'est copié dans le dépôt ou le
  site : la notice et le guide de jeu sont rédigés avec nos propres mots
  et schémas.

## Phases

0. **Fondations** — scaffolding backend/frontend, moteur de jeu comme
   package Python indépendant du framework web, modèle de salon
   générique. *(fait)*
1. **Moteur de règles Orapa Mine** — grille, points d'entrée, gemmes,
   placement valide, lancer de rayon + réflexions, mélange des couleurs,
   question ponctuelle, extensions (Diamant, Corps noir). *(fait pour la
   logique cœur ; voir `src/amusement/engine/orapa_mine/` et
   `tests/engine/orapa_mine/`, 28 tests unitaires — construits à la main
   plutôt que recopiés depuis l'exemple chiffré du livret, dont la grille
   exacte n'a pas pu être reconstituée avec certitude depuis le PDF
   scanné.)*
2. **Modes de jeu (logique)** — *(fait)*. Voir
   `src/amusement/engine/orapa_mine/generation.py`, `solution.py`,
   `duel.py`, `fouille.py` (26 tests supplémentaires). Décisions prises :
   - `generation.random_board` : tirage-rejet simple (retente un
     placement complet tant qu'une règle est violée) — largement
     suffisant pour 5-7 gemmes sur un plateau peu dense.
   - `duel.DuelGame` : implémente exactement la séquence de fin de
     partie du livret (proposition correcte du non-premier joueur =
     victoire immédiate ; proposition correcte du premier joueur = un
     dernier tour pour l'adversaire ; erreur = défaite immédiate).
     Interprétation ajoutée pour un cas non couvert par le livret : si
     l'adversaire n'utilise pas son dernier tour pour proposer une
     solution (il pose une question normale à la place), son unique
     chance est considérée consommée et la victoire du premier joueur
     est confirmée. Confirmer une réponse déjà donnée (`replay`) ne
     consomme pas de tour, conforme au livret.
   - `fouille.FouilleGame` : les deux variantes (parallèle privé / tour
     par tour) partagent la même logique de victoire/élimination,
     reprise de la variante 3+ joueurs officielle : une proposition
     erronée n'élimine qu'à la 2e erreur ; si tout le monde est éliminé,
     personne ne gagne. C'est le comportement par défaut retenu pour la
     pénalité en mode Fouille (question encore ouverte listée
     précédemment) — à ajuster si besoin, c'est isolé dans une seule
     méthode.
   - `solution.check_solution` : une proposition doit reproduire
     position + couleur + orientation exactes de chaque gemme (le
     livret ne précise pas si l'orientation compte ; choix conservateur
     par défaut).
3. **Rendu 3D et interactions (frontend)** — *(refait pour les vraies
   silhouettes, vérifié visuellement)*. Voir
   `frontend/src/games/orapa-mine/` :
   - `geometry.ts`, `piece-shapes.ts`, `piece-render.ts` : port TS de
     `geometry.py`/`pieces.py` (quartiers de case, placement par
     rotation/miroir).
   - `preview-engine.ts` + `colors.ts` + `borders.ts` : port TS du
     moteur (placement + tir de rayon par intersection d'arêtes de
     polygone, même physique qu'en Python), pour la démo hors ligne
     uniquement.
   - `board-scene.ts` : rendu Three.js — les pièces sont de vraies
     silhouettes extrudées (`THREE.Shape` + `ExtrudeGeometry`, pas des
     parois à une case), avec un contour sombre (`EdgesGeometry`) pour
     rester lisibles même en blanc sur le fond clair du plateau ; une
     pièce fantôme semi-transparente (verte/rouge selon validité) suit
     le survol pendant le placement.
   - `demo.ts` : démo jouable — palette avec les vraies silhouettes en
     icônes SVG, chaque pièce de la variante de base posable une seule
     fois (désactivée après placement, réactivée si retirée), bouton
     « Valider le placement » actif seulement à 5/5 qui verrouille
     ensuite palette/rotation/retrait, boutons rotation (90°) et miroir
     (nécessaire pour le parallélogramme, qui n'a pas de symétrie
     miroir).
   Vérifié visuellement (Playwright headless) : rendu des 5 silhouettes,
   pièce fantôme et placement, contrainte une-pièce-chacune avec
   verrouillage à la validation, tir de rayon avec réflexion correcte
   sur les vraies pièces, aucune erreur console.
   ⚠️ **Important pour la Phase 4** : `preview-engine.ts` est un moteur
   dupliqué côté client, utilisé UNIQUEMENT pour cette démo locale hors
   ligne. En multijoueur (Duel/Fouille), la résolution des tirs de rayon
   et la validation des propositions doivent rester côté serveur
   (`amusement.engine.orapa_mine`, Python) : le client ne doit jamais
   recevoir les positions de gemmes de l'adversaire en clair.
   Reste à faire : glisser-déposer natif (le placement actuel est
   clic-pour-armer + survol + clic-pour-poser, pas un vrai drag HTML5 —
   suffisant pour la démo mais à revisiter si besoin), feuille de
   solution numérique, écran de placement dédié au mode Duel (paravent
   réel = côté serveur), intégration des résultats reçus du serveur
   (Phase 4) à la place du moteur local.
4. **Multijoueur temps réel** — *(backend fait et vérifié ; câblage
   frontend restant)*. Voir `src/amusement/rooms/` (`room.py` : salon
   générique — code court sans caractères ambigus, statut LOBBY →
   PLACING (Duel) / PLAYING → FINISHED, joueurs ; `manager.py` : registre
   en mémoire, pas de persistance, cohérent avec « salons par lien, sans
   compte ») et `src/amusement/api/` (`rooms_api.py` : REST
   `POST /api/rooms` pour créer un salon ; `game_session.py` : relie un
   salon au moteur Orapa Mine, gère la phase de placement Duel
   pièce-par-pièce puis démarre `DuelGame`/`FouilleGame` ; `game_ws.py` :
   WebSocket `/ws/rooms/{code}`, un message JSON `{"type": ...}` par
   action, démarrage automatique dès le salon complet — pas de bouton
   "lancer" côté hôte en v1 ; `connections.py` : diffusion aux joueurs
   d'un salon).
   Décisions : les réponses aux questions (rayon/qu'y-a-t-il) restent
   privées au demandeur en Duel et Fouille parallèle, mais sont
   diffusées à tous en Fouille tour par tour (fidèle à la variante
   officielle 3+ joueurs) ; CORS ouvert en v1 (pas de compte, pas de
   données sensibles en REST) — à restreindre avant un déploiement
   public.
   Vérifié à deux niveaux : suite de tests d'intégration WebSocket
   (`tests/api/test_game_ws.py`, transport ASGI en mémoire) couvrant le
   flux Duel complet (placement → validation → questions) et Fouille ;
   puis un test de fumée avec un vrai serveur uvicorn lancé et deux
   connexions WebSocket réseau réelles, pour écarter tout écart entre le
   transport de test et un vrai réseau.
   **Câblage frontend fait et vérifié.** Voir `frontend/src/lib/`
   (`room-socket.ts` : client WebSocket générique, dispatch par
   `type` ; `config.ts` : adresse du backend, à externaliser en variable
   d'env avant déploiement) et `frontend/src/games/orapa-mine/` :
   - `protocol.ts` : traduction des messages, miroir à la main de
     `game_ws.py`/`game_session.py` (pas de schéma partagé généré — à
     surveiller si les deux dérivent).
   - `placement-controller.ts` : contrôleur de placement extrait de
     `demo.ts` pour être réutilisé à la fois pour poser son propre
     plateau (Duel) et pour construire une proposition de solution —
     pose optimiste en local puis notifie le serveur, qui reste seul
     juge (voir avertissement en tête du fichier `multiplayer.ts`).
   - `multiplayer.ts` : écrans créer/rejoindre (avec lien `?room=CODE`
     partageable), lobby, placement (Duel), prospection (questions +
     bascule vers un mode "proposer une solution" réutilisant le même
     contrôleur de placement sur un plateau de proposition séparé),
     écran de fin de partie. Le rayon n'est tracé qu'en ligne droite
     entrée→sortie (le serveur ne renvoie pas les rebonds
     intermédiaires) : contrairement à la démo hors ligne, exposer le
     chemin donnerait plus d'information qu'un vrai prospecteur n'en a
     jamais dans le jeu physique.
   Vérifié avec un vrai test à deux joueurs (deux contextes de
   navigateur, backend + frontend réellement lancés) : création de
   salon, jonction, placement complet des deux côtés, tour par tour,
   question, proposition de solution gagnante, écran de victoire/défaite
   corrects des deux côtés, aucune erreur console.
   **Bug trouvé et corrigé en cours de route** : le clic pour poser une
   pièce pouvait, près d'une grande pièce déjà posée, être intercepté de
   façon ambiguë par le rayon-tracé contre le maillage 3D de cette pièce
   au lieu du sol. Corrigé en unifiant la détection de case cliquée
   autour d'une intersection mathématique avec le plan y=0 (plus robuste
   qu'un rayon-tracé contre des maillages), et en laissant l'appelant
   (pas `BoardScene`) décider si une case cliquée contient une pièce à
   retirer — supprime une source d'ambiguïté entre "clic sur une pièce"
   et "clic sur le sol".
   Reste à faire : reconnexion après coupure réseau, rollback ciblé d'une
   pose optimiste rejetée par le serveur (actuellement juste loggée —
   voir le commentaire dans `multiplayer.ts`), affichage du plateau
   généré aléatoirement pour la relecture après une partie Fouille
   terminée.
5. **Notice & Guide de jeu** — *(fait)*. Voir `frontend/src/pages/`.
   - `notice/orapa-mine.ts` : règles reformulées avec nos propres mots
     (rien copié du livret) — plateau et gemmes, placement, physique du
     rayon (schémas SVG faits maison pour la déviation diagonale et le
     rebond droit, et pour la règle de contact par un point), couleurs,
     les deux modes, extensions. Utilise la vraie palette de pièces
     (`piece-icon.ts`, factorisé depuis `demo.ts`/`placement-controller.ts`
     qui le dupliquaient) pour illustrer chaque gemme avec sa vraie
     silhouette.
   - `guide/orapa-mine.ts` : tutoriel pas-à-pas sur un plateau 3D réel
     (6 étapes : plateau, une gemme posée, déviation diagonale, rebond
     droit, mélange de couleurs, puis la démo hors ligne complète pour
     s'entraîner librement). Les scénarios (positions, sens de
     réflexion) sont exactement ceux vérifiés dans
     `test_raycast.py` côté backend, pas re-inventés.
   Vérifié visuellement (Playwright) : les 3 tirs guidés (étapes 3 à 5)
   produisent exactement les résultats attendus — mêmes chiffres que les
   tests backend — et la démo finale s'intègre sans erreur console.
6. **Portail multi-jeux** — accueil listant les jeux, création/jonction de
   salon générique, réutilisable pour de futurs jeux.

## Décisions prises en Phase 1 (moteur de règles)

- **Dimensions du plateau** : 9x9 par défaut (`BoardDimensions`,
  paramétrable). Hypothèse retenue car elle permet une répartition
  propre des 36 points d'entrée en 18 numéros (bords haut/bas) + 18
  lettres (bords gauche/droit) = 18+18, conforme au livret — non
  confirmée visuellement avec certitude (voir « Points ouverts »).
- **Mélange des couleurs** : confirmé intégralement par le tableau de
  mélanges du livret (photographié par l'utilisateur, voir
  `regles/orapamine.jpg`) — couleur+blanc → version claire, deux couleurs
  sans blanc → mélange peinture (rouge+jaune=orange, jaune+bleu=vert,
  rouge+bleu=violet), deux couleurs+blanc → version claire du mélange,
  rouge+jaune+bleu sans blanc → **noir**, les 4 couleurs → gris. Les 15
  combinaisons possibles sont donc toutes couvertes sans cas par défaut.

## Révision Phase 1 (2026-08-19) : vraies silhouettes de pièces

Le modèle initial (une gemme = une case avec un miroir diagonal) était
**faux** : l'utilisateur a fourni la vraie composition des pièces
(polyominos de carrés + demi-cases triangulaires), confirmée
visuellement via un artifact avant réécriture. Détail complet dans
l'artifact « Pièces d'Orapa Mine » (schémas de chaque pièce). Résumé :

- **5 silhouettes réelles**, chacune composée de cases (`carré`, 1×1) et
  de demi-cases (`triangle`, moitié d'une case coupée en diagonale) :
  `MEDIUM_TRIANGLE` (jaune, 1 carré + 2 triangles), `PARALLELOGRAM`
  (rouge, 1 carré + 2 triangles), `RHOMBUS` (blanc, 4 triangles),
  `LARGE_TRIANGLE` (blanc **ou** bleu — même silhouette, deux couleurs
  possibles, 2 carrés + 4 triangles). Correspond exactement à « 1 rouge,
  1 jaune, 1 bleue et 2 blanches » du livret (`generation.BASE_PIECE_SET`).
- **Diamant / Corps noir** : silhouette confirmée par l'utilisateur (2026-
  08-20) — `PieceShape.TENT`, deux demi-cases accolées par leur
  hypoténuse formant un triangle isocèle de 2 cases de large, pointe vers
  le haut (et non 1×1 comme initialement supposé).
- **Modèle géométrique** : chaque pièce est un polygone convexe à coins
  entiers (voir `pieces.py` pour les sommets canoniques), placée par
  rotation (pas de 90°) + miroir optionnel (nécessaire pour le
  parallélogramme, qui n'a pas de symétrie miroir) + translation.
- **Validation du placement** (`geometry.py`, `board.py`) : chaque case
  est divisée en 4 « quartiers » triangulaires (N/E/S/W) pour représenter
  exactement les moitiés de case en arithmétique entière (aucun
  flottant — la règle de contact « seulement par un point » est un cas
  limite numériquement délicat, l'entier exact l'évite complètement).
  Deux pièces ne peuvent jamais partager un bord de longueur non nulle,
  seulement un point.
- **Physique du rayon** (`raycast.py`), nouvelle question posée par les
  pièces multi-cases : un rayon peut désormais heurter un bord **droit**
  de face (perpendiculaire), pas seulement une diagonale. Confirmé avec
  l'utilisateur avant implémentation : dans ce cas, **rebond à 180°**, le
  rayon ressort par son point d'entrée — mécanisme « réflexion » du jeu
  classique Black Box dont s'inspire Orapa Mine. Une diagonale continue
  de dévier à 90° comme avant. Recalculé en arithmétique entière exacte
  (échelle ×2) et vérifié indépendamment par la loi de réflexion d'un
  miroir (d' = d - 2(d·n̂)n̂) sur plusieurs cas à la main avant de coder
  les tests.
- **`solution.check_solution`** revu : compare l'empreinte géométrique
  réelle de chaque pièce (pas ses paramètres bruts de placement), pour
  ne pas rejeter à tort une proposition correcte obtenue par une autre
  combinaison rotation/miroir produisant la même silhouette (ex: le
  losange a une symétrie de rotation).
- Le frontend (Phase 3) utilise encore l'ancien modèle à une case : à
  refaire.

## Points ouverts / à valider

- Dimensions exactes de la grille et répartition précise des points
  d'entrée (numéros / lettres) : l'hypothèse 9x9 est mathématiquement
  cohérente mais pas confirmée visuellement. Le moteur de rayon
  (`raycast.fire_ray`) est indépendant de ce choix ; seul `borders.py`
  serait à corriger si besoin.
- Chronométrage en mode Fouille : affiché en direct ou seulement au
  résultat final.
- Variante de base (5 gemmes) vs extensions (Diamant, Corps noir)
  configurables à la création du salon.

## Notes d'environnement

- Node.js local est en version 20.16.0 ; Vite 8 demande officiellement
  20.19+ ou 22.12+. Le build fonctionne malgré l'avertissement, mais une
  mise à jour de Node est recommandée avant d'aller plus loin en Phase 3.
