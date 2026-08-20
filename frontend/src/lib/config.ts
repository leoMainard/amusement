/** Adresse du backend. Dérivée de l'hôte utilisé pour charger la page
 * (même machine, port 8000) plutôt que codée en dur sur "localhost" :
 * ça permet de tester depuis un autre appareil du même réseau local
 * (téléphone...) en ouvrant le frontend via l'IP de la machine, sans
 * rien reconfigurer. Ne fonctionne que pour un backend sur la même
 * machine que le frontend — à revoir avant un vrai déploiement (backend
 * et frontend sur des origines différentes), voir docs/plan.md. */
const BACKEND_PORT = 8000;
const host = typeof window !== "undefined" ? window.location.hostname : "localhost";

export const API_BASE_URL = `http://${host}:${BACKEND_PORT}`;
export const WS_BASE_URL = `ws://${host}:${BACKEND_PORT}`;
