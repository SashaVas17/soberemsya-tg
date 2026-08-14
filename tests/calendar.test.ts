import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  googleCalendarTimestamp,
  googleCalendarUrl,
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

  it("keeps Google Calendar unchanged and opens iPhone Calendar through a signed backend link", () => {
    expect(resultSource).toContain("googleCalendarUrl");
    expect(resultSource).toContain("Google Calendar");
    expect(resultSource).toContain("Календарь iPhone");
    expect(resultSource).toContain("api.calendarLink(event.id)");
    expect(resultSource).toContain("openExternalUrl(icsUrl)");
    expect(resultSource).not.toContain("downloadCalendarIcs");
    expect(resultSource).not.toContain("navigator.share");
    expect(resultSource).not.toContain("TELEGRAM_DB_SECRET_KEY");
    expect(calendarSource).not.toContain("navigator.share");
    expect(resultSource).toContain("onClick={() => shareResult(event.id)}");
    expect(resultSource).toContain('setCalendarError("Не удалось открыть календарь. Попробуйте ещё раз.")');
    expect(resultSource).not.toContain("setCalendarError(error");
  });

  it("uses the shared Telegram-blue treatment for both calendar actions and result sharing", () => {
    const stylesSource = readFileSync("src/styles.css", "utf8");
    const calendarActionClasses = resultSource.match(/className="primary-action calendar-action"/g) ?? [];

    expect(calendarActionClasses).toHaveLength(2);
    expect(resultSource).toContain('className="primary-action share-result-action"');
    expect(resultSource).not.toContain('className="secondary-action calendar-action"');
    expect(stylesSource).toContain(".primary-action,\n.telegram-action");
    expect(stylesSource).toContain("background: var(--color-telegram)");
    expect(stylesSource).toContain("color: var(--color-on-telegram)");
  });
});

describe("external signed ICS opening", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Telegram WebApp openLink for a signed ICS URL when available", () => {
    const openLink = vi.fn();
    vi.stubGlobal("window", { Telegram: { WebApp: { openLink } } });
    const icsUrl = "https://project.supabase.co/functions/v1/telegram-api/calendar/evt_1?expires=1&signature=ticket";
    openExternalUrl(icsUrl);
    expect(openLink).toHaveBeenCalledWith(icsUrl);
  });

  it("falls back to the browser when Telegram openLink throws", () => {
    const openLink = vi.fn(() => {
      throw new Error("Telegram navigation failed");
    });
    const open = vi.fn();
    vi.stubGlobal("window", { Telegram: { WebApp: { openLink } }, open });
    const icsUrl = "https://project.supabase.co/functions/v1/telegram-api/calendar/evt_1?expires=1&signature=ticket";

    openExternalUrl(icsUrl);

    expect(openLink).toHaveBeenCalledWith(icsUrl);
    expect(open).toHaveBeenCalledWith(icsUrl, "_blank", "noopener,noreferrer");
  });

  it("falls back to the browser for a signed ICS URL outside Telegram", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const icsUrl = "https://project.supabase.co/functions/v1/telegram-api/calendar/evt_1?expires=1&signature=ticket";
    openExternalUrl(icsUrl);
    expect(open).toHaveBeenCalledWith(
      icsUrl,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
