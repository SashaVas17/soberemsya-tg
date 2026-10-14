import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/soberemsya-tg/",
  plugins: [react()],
  // The map chunk (maplibre, ~1 MB, ~290 kB gzip) is loaded only when the map
  // is opened, so its size does not slow down the app start.
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1100 },
  server: { port: 5173 },
  // The maplibre worker is an ES module with imports (see src/ui/VenueMap.tsx).
  worker: { format: "es" },
});
