import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  downloadCalendarIcs,
  googleCalendarTimestamp,
  googleCalendarUrl,
  icsCalendarText,
} from "../src/calendar";
import { resultPlace, resultTime } from "../src/result-model";
import { openExternalUrl } from "../src/telegram";
import type { EventData } from "../src/types";

const resultSource = readFileSync("src/App.tsx", "utf8");
const calendarSource = readFileSync("src/calendar.ts", "utf8");

const startsAt = "2026-08-15T16:00:00.000Z";
const endsAt = "2026-08-15T18:00:00.000Z";

function event(overrides: Partial<EventData> = {}): EventData {
  return {
    id: "event-1",
    title: "День рождения, Маша",
    description: "Возьмите плед",
    budgetLimit: 30,
    visibility: "private",
    maxParticipants: null,
    status: "decided",
    finalPlaceId: "place-2",
    finalTimeOptionId: "time-2",
    timeOptions: [
      { id: "time-1", startsAt: "2026-08-14T16:00:00.000Z", availableCount: 2 },
      { id: "time-2", startsAt, availableCount: 4 },
    ],
    placeOptions: [
      { id: "place-1", title: "Парк", area: "Немига", estimatedBudget: 0 },
      { id: "place-2", title: "Публика", area: "Октябрьская", estimatedBudget: 0 },
    ],
    participants: [],
    canManage: false,
    myResponse: null,
    ...overrides,
  };
}

describe("Google Calendar link", () => {
  it("builds the template URL with encoded title, location and Cyrillic", () => {
    const url = googleCalendarUrl({
      title: "День рождения, Маша",
      startsAt,
      endsAt,
      location: "Публика, Октябрьская",
      description: "Возьмите плед",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("День рождения, Маша");
    expect(parsed.searchParams.get("location")).toBe("Публика, Октябрьская");
    expect(url).toContain("%D0%94%D0%B5%D0%BD%D1%8C");
  });

  it("uses UTC timestamps in Google Calendar's dates format", () => {
    expect(googleCalendarTimestamp(startsAt)).toBe("20260815T160000Z");
    expect(googleCalendarUrl({ title: "Встреча", startsAt, endsAt })).toContain(
      "dates=20260815T160000Z%2F20260815T180000Z",
    );
  });

  it("uses the real final time and place, with the existing fallback selection", () => {
    const decided = event();
    expect(resultTime(decided)?.startsAt).toBe(startsAt);
    expect(resultPlace(decided)?.title).toBe("Публика");

    const fallback = event({ finalTimeOptionId: null, finalPlaceId: null });
    expect(resultTime(fallback)?.startsAt).toBe(startsAt);
    expect(resultPlace(fallback)?.title).toBe("Парк");
  });

  it("keeps ICS text as a CRLF and escaped frontend-only fallback", () => {
    const text = icsCalendarText({
      title: "Встреча, тест; один",
      startsAt,
      endsAt,
      location: "Минск\nПарк",
    });
    expect(text).toContain("\r\n");
    expect(text).toContain("SUMMARY:Встреча\\, тест\\; один");
    expect(text).toContain("LOCATION:Минск\\nПарк");
  });

  it("keeps Google and iPhone calendar actions available through the existing ICS helper", () => {
    expect(resultSource).toContain("googleCalendarUrl");
    expect(resultSource).toContain("Google Calendar");
    expect(resultSource).toContain("downloadCalendarIcs");
    expect(resultSource).toContain("Календарь iPhone");
    expect(resultSource).toContain("if (!recommendedTime) return;");
    expect(resultSource).not.toContain("api.calendar");
    expect(resultSource).not.toContain("TELEGRAM_DB_SECRET_KEY");
    expect(calendarSource).toContain('type: "text/calendar;charset=utf-8"');
    expect(calendarSource).toContain("navigator.canShare");
  });

  it("uses the same primary treatment for both calendar actions and a distinct Telegram share action", () => {
    const stylesSource = readFileSync("src/styles.css", "utf8");
    const calendarActionClasses = resultSource.match(/className="primary-action calendar-action"/g) ?? [];

    expect(calendarActionClasses).toHaveLength(2);
    expect(resultSource).toContain('className="primary-action share-result-action"');
    expect(resultSource).not.toContain('className="secondary-action calendar-action"');
    expect(stylesSource).toContain(".result-actions .share-result-action");
    expect(stylesSource).toContain("background: var(--color-telegram)");
    expect(stylesSource).toContain("color: var(--color-on-telegram)");
  });
});

describe("external calendar opening", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the native share sheet for an iPhone ICS action when available", async () => {
    const file = { name: "soberemsya.ics" };
    const canShare = vi.fn(() => true);
    const share = vi.fn().mockResolvedValue(undefined);
    function MockFile() {
      return file;
    }
    vi.stubGlobal("File", MockFile);
    vi.stubGlobal("navigator", { canShare, share });

    await downloadCalendarIcs({ title: "Встреча", startsAt, endsAt });

    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(share).toHaveBeenCalledWith({ files: [file], title: "Встреча" });
  });

  it("uses Telegram WebApp openLink when available", () => {
    const openLink = vi.fn();
    vi.stubGlobal("window", { Telegram: { WebApp: { openLink } } });
    openExternalUrl("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(openLink).toHaveBeenCalledOnce();
  });

  it("falls back to the browser outside Telegram", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openExternalUrl("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(open).toHaveBeenCalledWith(
      "https://calendar.google.com/calendar/render?action=TEMPLATE",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
