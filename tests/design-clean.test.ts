import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Graphite and coral (2026-10-22, docs/notes/Дизайн.md): liquid glass only on
// chrome and primary buttons, a gradient only in the background glow and the
// glass sheen, no uppercase labels and no emoji.
const files = ["src/design-tokens.css", "src/styles.css", "src/theme-sunset.css"];
const css = files.map((file) => readFileSync(file, "utf8")).join("\n");

/** Selectors of every top-level or nested rule whose body contains `pattern`. */
function selectorsWith(pattern: RegExp) {
  const found: string[] = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (pattern.test(match[2])) found.push(...match[1].split(",").map((part) => part.trim()));
  }
  return found;
}

const glassAllowed = new Set([
  ".topbar",
  ".bottom-navigation",
  ".participant-remove-dialog",
  ".time-picker-dialog",
  ".map-selection .meeting-card",
  ".primary-action:not(:disabled)",
  ".bottom-navigation-create",
]);
const gradientAllowed = new Set([
  ".app-shell::before",
  ".primary-action:not(:disabled)",
  ".bottom-navigation-create",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("design rules", () => {
  it("keeps backdrop blur on chrome and primary buttons only", () => {
    const blurred = selectorsWith(/backdrop-filter/);
    expect(blurred.length).toBeGreaterThan(0);
    expect(blurred.filter((selector) => !glassAllowed.has(selector))).toEqual([]);
  });

  it("keeps gradients to the background glow and the glass sheen", () => {
    const graded = selectorsWith(/(linear|radial|conic)-gradient/);
    expect(graded.filter((selector) => !gradientAllowed.has(selector))).toEqual([]);
    // A gradient hidden in a custom property would slip past the selector check.
    expect(css).not.toMatch(/--[\w-]+:\s*[^;]*(linear|radial|conic)-gradient/);
  });

  it("has no violet, pink or peach left from the old palette", () => {
    expect(css).not.toMatch(/#(6a3cf0|5428d6|4519c0|b49bff|c8b6ff|140a24|130a1a|221530|e8467c|ff6fa3|ff9a6a)/i);
  });

  it("keeps labels in sentence case", () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("has no emoji in the interface", () => {
    const emoji = /\p{Emoji_Presentation}/u; // «©» of the OSM credit is not one
    const offenders = sources("src").filter((file) => emoji.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
