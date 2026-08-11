import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { managePayloads, runActionOnce } from "../src/manage-actions";
import { eventShareUrl, resultShareUrl } from "../src/meeting-links";
import { resultPlace, resultTime } from "../src/result-model";
import type { EventData } from "../src/types";

const decidedEvent: EventData = {
  id: "evt_decided",
  title: "День рождения",
  description: "Встречаемся вечером",
  budgetLimit: 50,
  status: "decided",
  finalPlaceId: "place_pub",
  finalTimeOptionId: "time_evening",
  timeOptions: [
    { id: "time_day", startsAt: "2026-08-15T12:00:00.000Z", availableCount: 1 },
    { id: "time_evening", startsAt: "2026-08-15T16:00:00.000Z", availableCount: 3 },
  ],
  placeOptions: [
    { id: "place_park", title: "Парк", area: "Центр", estimatedBudget: 20 },
    { id: "place_pub", title: "Публика", area: "Немига", estimatedBudget: 45 },
  ],
  participants: [],
  canManage: true,
  myResponse: null,
};

describe("Organizer Management actions", () => {
  it("keeps the existing details and decision payloads", () => {
    expect(managePayloads.updateDetails("Встреча", "Описание")).toEqual({
      action: "update_details",
      title: "Встреча",
      description: "Описание",
    });
    expect(managePayloads.decide("time_1", "place_1")).toEqual({
      action: "decide",
      finalTimeOptionId: "time_1",
      finalPlaceId: "place_1",
    });
  });

  it("keeps add/remove time payloads", () => {
    expect(managePayloads.addTime("2026-08-15T16:00:00.000Z")).toEqual({
      action: "add_time",
      startsAt: "2026-08-15T16:00:00.000Z",
    });
    expect(managePayloads.removeTime("time_1", true)).toEqual({
      action: "remove_time",
      timeOptionId: "time_1",
      force: true,
    });
  });

  it("keeps add/remove place payloads", () => {
    const place = { title: "Парк", area: "Центр", estimatedBudget: 25 };
    expect(managePayloads.addPlace(place)).toEqual({
      action: "add_place",
      place,
    });
    expect(managePayloads.removePlace("place_1")).toEqual({
      action: "remove_place",
      placeOptionId: "place_1",
    });
  });

  it("keeps close and reopen payloads", () => {
    expect(managePayloads.close()).toEqual({ action: "close" });
    expect(managePayloads.reopen()).toEqual({ action: "reopen" });
  });

  it("allows only one close request for one in-flight action", async () => {
    let finish!: (value: { ok: true }) => void;
    const manage = vi.fn(
      (payload: unknown) => {
        void payload;
        return new Promise<{ ok: true }>(
          (resolve) => void (finish = resolve),
        );
      },
    );
    const lock = { current: false };
    const first = runActionOnce(lock, () => manage(managePayloads.close()));
    const second = runActionOnce(lock, () => manage(managePayloads.close()));
    expect(manage).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBeNull();
    finish({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
  });

  it("allows only one decide request for one in-flight action", async () => {
    const manage = vi.fn(async (payload: unknown) => {
      void payload;
      return { ok: true };
    });
    const lock = { current: false };
    await runActionOnce(lock, () =>
      manage(managePayloads.decide("time_1", "place_1")),
    );
    expect(manage).toHaveBeenCalledTimes(1);
  });

  it("keeps the invitation deep link for share", () => {
    expect(decodeURIComponent(eventShareUrl("evt_1", "bot", "app"))).toContain(
      "https://t.me/bot/app?startapp=event_evt_1",
    );
  });
});

describe("Final Result", () => {
  it("uses the existing selected final date/time and place", () => {
    expect(resultTime(decidedEvent)?.id).toBe("time_evening");
    expect(resultPlace(decidedEvent)?.id).toBe("place_pub");
  });

  it("keeps existing fallbacks for incomplete final references", () => {
    const incomplete = {
      ...decidedEvent,
      finalTimeOptionId: "missing_time",
      finalPlaceId: "missing_place",
    };
    expect(resultTime(incomplete)?.id).toBe("time_evening");
    expect(resultPlace(incomplete)?.id).toBe("place_park");
    expect(resultPlace({ ...incomplete, placeOptions: [] })).toBeNull();
  });

  it("keeps result sharing on the same deep link", () => {
    expect(decodeURIComponent(resultShareUrl("evt_1", "bot", "app"))).toContain(
      "https://t.me/bot/app?startapp=event_evt_1",
    );
  });
});

describe("Phase E screen and state boundaries", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const manageSource = appSource.slice(
    appSource.indexOf("function Manage("),
    appSource.indexOf("function Result("),
  );
  const resultSource = appSource.slice(
    appSource.indexOf("function Result("),
    appSource.indexOf("function telegramAppConfig("),
  );
  const stateSource = appSource.slice(
    appSource.indexOf("function Loading("),
    appSource.indexOf("function StatusBadge("),
  );

  it("loads the existing meeting and displays real availableCount", () => {
    expect(manageSource).toContain("const state = useEvent(eventId)");
    expect(manageSource).toContain("slot.availableCount");
    expect(manageSource).toContain("event.participants");
  });

  it("keeps delete confirmation, API action and navigation", () => {
    expect(manageSource).toContain('confirm("Удалить встречу?")');
    expect(manageSource).toContain("api.remove(event.id)");
    expect(manageSource).toContain('navigate("/my-events", true)');
  });

  it("keeps permission, API error and retry handling", () => {
    expect(manageSource).toContain("!event.canManage");
    expect(manageSource).toContain("<RetryState");
    expect(manageSource).toContain("state.error");
    expect(manageSource).toContain("onRetry={() => void state.load()}");
  });

  it("does not add place voting or presentation fetches", () => {
    expect(appSource).not.toContain("place_votes");
    expect(appSource).not.toContain("placeVoteCount");
    expect(appSource).not.toContain("placeVotingEnabled");
    expect(manageSource).not.toContain("api.event");
  });

  it("uses the frontend Google Calendar action and keeps an ICS helper", () => {
    const calendarSource = readFileSync("src/calendar.ts", "utf8");
    expect(resultSource).toContain("googleCalendarUrl");
    expect(resultSource).toContain("openExternalUrl");
    expect(calendarSource).toContain("BEGIN:VCALENDAR");
    expect(calendarSource).toContain('type: "text/calendar;charset=utf-8"');
    expect(calendarSource).toContain('join("\\r\\n")');
    expect(resultSource).not.toContain("api.calendar");
    expect(resultSource).not.toContain('request("/calendar');
    expect(resultSource).not.toContain("fetch(");
  });

  it("keeps Return Home and excludes BottomNavigation", () => {
    expect(resultSource).toContain('navigate("/")');
    expect(manageSource).not.toContain("<BottomNavigation");
    expect(resultSource).not.toContain("<BottomNavigation");
  });

  it("keeps empty and API error states distinct", () => {
    expect(stateSource).toContain('className="state-card empty-state"');
    expect(stateSource).toContain('className="state-card error-state"');
    expect(stateSource).toContain('role="alert"');
  });

  it("keeps retry bound to the existing load and unexpected messages visible", () => {
    expect(stateSource).toContain("{message}");
    expect(stateSource).toContain("onClick={onRetry}");
    expect(manageSource).toContain("reason instanceof Error");
    expect(manageSource).toContain("reason.message");
  });

  it("does not bind mutating requests to theme changes", () => {
    expect(manageSource).not.toContain("resolvedTheme");
    expect(manageSource).not.toContain("toggleTheme");
  });
});
