// Content-Security-Policy of the production build (GitHub Pages cannot send
// headers, so it goes into a <meta> tag). The dev server is left without it:
// Vite's hot reload needs inline scripts. If the app starts using a new host,
// add it here, or the browser blocks it.

const telegramScript = "https://telegram.org";
const mapTiles = "https://tiles.openfreemap.org";
// The administrator's app asks Overpass itself (src/osm-import.ts); the same
// servers as OVERPASS_URLS in supabase/functions/_shared/venues.ts (a test checks).
export const OVERPASS_ORIGINS = ["https://overpass-api.de", "https://overpass.private.coffee", "https://overpass.kumi.systems"];

function origin(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(env: Record<string, string | undefined>) {
  const connect = new Set(["'self'", mapTiles, ...OVERPASS_ORIGINS]);
  for (const url of [env.VITE_SERVER_FUNCTION_URL, env.VITE_SUPABASE_URL, env.VITE_MAP_STYLE_URL, env.VITE_MAP_STYLE_DARK_URL]) {
    const value = origin(url);
    if (value) connect.add(value);
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${telegramScript}`,
    // React sets styles through the DOM; MapLibre adds inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${[...connect].join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}
