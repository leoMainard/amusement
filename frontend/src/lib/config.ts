/** Adresse du backend.
 *
 * Par défaut, dérivée de l'hôte utilisé pour charger la page (même
 * machine, port 8000) plutôt que codée en dur sur "localhost" : ça
 * permet de tester depuis un autre appareil du même réseau local
 * (téléphone...) en ouvrant le frontend via l'IP de la machine, sans
 * rien reconfigurer.
 *
 * Peut être remplacée via `frontend/.env.local` (VITE_API_BASE_URL /
 * VITE_WS_BASE_URL, non versionné) — nécessaire quand frontend et
 * backend sont exposés séparément (ex : deux tunnels Cloudflare avec
 * des adresses différentes, voir docs/plan.md). Redémarrer `npm run
 * dev` après avoir modifié ce fichier : Vite ne le recharge pas à
 * chaud. */
const BACKEND_PORT = 8000;
const host = typeof window !== "undefined" ? window.location.hostname : "localhost";

const envApiUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const envWsUrl = import.meta.env.VITE_WS_BASE_URL as string | undefined;

export const API_BASE_URL = envApiUrl || `http://${host}:${BACKEND_PORT}`;
export const WS_BASE_URL = envWsUrl || `ws://${host}:${BACKEND_PORT}`;
