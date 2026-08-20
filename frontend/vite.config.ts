import { defineConfig } from "vite";

// `host: true` fait écouter le serveur de dev sur toutes les interfaces
// (pas seulement localhost) : nécessaire pour le tester depuis un autre
// appareil du même réseau (téléphone...). Voir README.md.
export default defineConfig({
  server: { host: true },
});
