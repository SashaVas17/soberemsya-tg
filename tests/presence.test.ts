import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Dialogs leave with a short exit instead of vanishing (motion audit 2026-10-22).
const css = readFileSync("src/theme-sunset.css", "utf8") + readFileSync("src/styles.css", "utf8");

describe("motion", () => {
  it("keeps every closing dialog on screen for its exit", () => {
    for (const file of ["src/screens/Manage.tsx", "src/screens/ParticipantEvent.tsx", "src/screens/CreateEvent.tsx", "src/ui/Moderation.tsx", "src/screens/PublicMeetings.tsx"])
      expect(readFileSync(file, "utf8")).toContain("<Presence show=");
    expect(css).toContain(".presence-leaving .participant-remove-dialog");
    expect(readFileSync("src/ui/Moderation.tsx", "utf8")).toContain("useLeaving()");
  });

  it("never animates layout: bars grow by clip-path, not width", () => {
    expect(css).not.toMatch(/transition:[^;]*\bwidth\b/);
    expect(css).toContain("clip-path: inset(0 calc((1 - var(--share, 0)) * 100%) 0 0 round 999px)");
  });

  it("stops the spinner with reduced motion", () => {
    expect(readFileSync("src/styles.css", "utf8")).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.spinner,\s*\.spin\s*\{\s*animation: none;/);
  });

  it("changes screens in a View Transition only when it is supported and motion is welcome", () => {
    const hooks = readFileSync("src/app-hooks.ts", "utf8");
    expect(hooks).toContain('typeof document.startViewTransition === "function"');
    expect(hooks).toContain("prefers-reduced-motion: reduce");
    expect(hooks).toContain("document.startViewTransition(() => flushSync(update))");
  });
});
