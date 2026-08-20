# Orapa Mine — frontend

À implémenter (Phase 3 du plan) :

- rendu 3D du plateau (grille, gemmes en volume, paravent) avec Three.js ;
- interface de placement des gemmes (mode Duel) avec contraintes visuelles ;
- interface de tir de rayon (sélection du point d'entrée, animation de la
  réflexion, couleur de sortie) ;
- feuille de solution numérique synchronisée avec les réponses reçues.

Ce module communique avec le backend (`amusement.engine.orapa_mine`) via
l'API/WebSocket définie en Phase 4 — il ne réimplémente aucune règle de jeu
côté client au-delà de l'affichage et d'une validation optimiste légère.
