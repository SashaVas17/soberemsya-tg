import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

describe("Telegram action styling", () => {
  it("uses one Telegram-blue treatment for active primary and full-width CTA actions", () => {
    expect(stylesSource).toContain(".primary-action,\n.telegram-action");
    expect(stylesSource).toContain("background: var(--color-telegram)");
    expect(stylesSource).toContain("color: var(--color-on-telegram)");
    expect(appSource).toContain('className="secondary-action telegram-action"');
  });

  it("keeps destructive actions red and disabled actions neutral", () => {
    expect(stylesSource).toContain(".danger-button {");
    expect(stylesSource).toContain("color: var(--coral)");
    expect(stylesSource).toContain(".primary-action:disabled,");
    expect(stylesSource).toContain("background: var(--color-surface-secondary)");
    expect(stylesSource).toContain("color: var(--color-text-secondary)");
  });

  it("keeps result sharing and both calendar actions on the shared active treatment", () => {
    const calendarActions = appSource.match(/className="primary-action calendar-action"/g) ?? [];

    expect(calendarActions).toHaveLength(2);
    expect(appSource).toContain('className="primary-action share-result-action"');
    expect(appSource).toContain("googleCalendarUrl(details)");
    expect(appSource).toContain("api.calendarLink(event.id)");
  });
});
