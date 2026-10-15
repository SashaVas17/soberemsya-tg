import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { contentSecurityPolicy } from "./csp";

// Adds the CSP <meta> to the built index.html only (see csp.ts).
function cspMeta(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "flockly-csp",
    apply: "build",
    configResolved(config) {
      env = { ...loadEnv(config.mode, config.envDir ?? process.cwd(), "VITE_"), ...process.env } as Record<string, string>;
    },
    transformIndexHtml: () => [{
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(env) },
      injectTo: "head-prepend",
    }],
  };
}

export default defineConfig({
  base: "/soberemsya-tg/",
  plugins: [react(), cspMeta()],
  // The map chunk (maplibre, ~1 MB, ~290 kB gzip) is loaded only when the map
  // is opened, so its size does not slow down the app start.
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1100 },
  server: { port: 5173 },
  // The maplibre worker is an ES module with imports (see src/ui/VenueMap.tsx).
  worker: { format: "es" },
});
