import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The cleaned «Закат» (2026-10-21): opaque surfaces, no glass, glows,
// gradients or emoji in the interface. See docs/notes/Дизайн.md.
const css = ["src/design-tokens.css", "src/styles.css", "src/theme-sunset.css"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("clean design", () => {
  it("has no backdrop blur or gradients", () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/(linear|radial|conic)-gradient/);
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
