import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the DreamGraph daemon at /explorer/.
// Built artifacts must reference assets relative to that path, and they
// land directly in dist/explorer-spa/ so they ship next to the compiled
// daemon (dist/index.js + dist/explorer/routes.js).
export default defineConfig({
  base: "/explorer/",
  plugins: [react()],
  build: {
    outDir: "../dist/explorer-spa",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    // Standalone vite dev mode: proxy API calls to a running daemon.
    proxy: {
      "/explorer/api": "http://localhost:8010",
    },
  },
});
