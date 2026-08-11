import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  eventShareUrl,
  managementPath,
  miniAppLink,
} from "../src/meeting-links";
import {
  saveResponseOnce,
  saveResponsePayload,
  toggleTimeOption,
  votingDraftFromEvent,
  type VotingDraft,
} from "../src/participant-voting";
import type { EventData } from "../src/types";

const event: EventData = {
  id: "evt_real",
  title: "Шашлыки с друзьями",
  description: "Встречаемся в выходные",
  budgetLimit: 40,
  status: "collecting",
  finalPlaceId: null,
  finalTimeOptionId: null,
  timeOptions: [
    { id: "time_1", startsAt: "2026-08-15T14:00:00.000Z", availableCount: 1 },
    { id: "time_2", startsAt: "2026-08-16T15:00:00.000Z", availableCount: 0 },
  ],
  placeOptions: [],
  participants: [],
  canManage: false,
  myResponse: null,
};

const responseDraft: VotingDraft = {
  area: "Немига",
  budget: 35,
  preferences: "Тихий стол",
  restrictions: "Без орехов",
  availableTimeOptionIds: ["time_1", "time_2"],
};

describe("Meeting Created", () => {
  it("uses the real event id in the existing deep link", () => {
    expect(miniAppLink("evt_real", "soberemsya_bot", "app")).toBe(
      "https://t.me/soberemsya_bot/app?startapp=event_evt_real",
    );
  });

  it("opens management with the real event id", () => {
    expect(managementPath("evt_real")).toBe("/manage/evt_real");
  });

  it("keeps the existing Telegram share URL and invitation text", () => {
    const url = eventShareUrl("evt_real", "soberemsya_bot", "app");
    expect(url).toContain("https://t.me/share/url?url=");
    expect(decodeURIComponent(url)).toContain(
      "https://t.me/soberemsya_bot/app?startapp=event_evt_real",
    );
    expect(decodeURIComponent(url)).toContain(
      "Соберёмся?\nПроголосуйте за удобное время и место:",
    );
  });
});

describe("Participant Voting", () => {
  it("loads all real time options for a new response", () => {
    expect(votingDraftFromEvent(event).availableTimeOptionIds).toEqual([
      "time_1",
      "time_2",
    ]);
  });

  it("selects and unselects a time option", () => {
    expect(toggleTimeOption([], "time_1")).toEqual(["time_1"]);
    expect(toggleTimeOption(["time_1"], "time_1")).toEqual([]);
  });

  it("preserves multiple selected time options", () => {
    expect(toggleTimeOption(["time_1"], "time_2")).toEqual([
      "time_1",
      "time_2",
    ]);
  });

  it("keeps all existing free-text and optional fields", () => {
    expect(saveResponsePayload(responseDraft)).toMatchObject({
      area: "Немига",
      budget: 35,
      preferences: "Тихий стол",
      restrictions: "Без орехов",
    });
  });

  it("sends exactly the existing saveResponse payload", () => {
    expect(saveResponsePayload(responseDraft)).toEqual({
      area: "Немига",
      budget: 35,
      preferences: "Тихий стол",
      restrictions: "Без орехов",
      availableTimeOptionIds: ["time_1", "time_2"],
    });
  });

  it("performs only one save while a submission is in flight", async () => {
    let finish!: (value: { event: EventData }) => void;
    const saveResponse = vi.fn(
      () =>
        new Promise<{ event: EventData }>((resolve) => {
          finish = resolve;
        }),
    );
    const lock = { current: false };

    const first = saveResponseOnce("evt_real", responseDraft, lock, saveResponse);
    const second = saveResponseOnce("evt_real", responseDraft, lock, saveResponse);

    expect(saveResponse).toHaveBeenCalledTimes(1);
    expect(saveResponse).toHaveBeenCalledWith("evt_real", responseDraft);
    await expect(second).resolves.toBeNull();
    finish({ event });
    await expect(first).resolves.toEqual({ event });
  });

  it("opens an existing response for editing", () => {
    const existing = {
      ...event,
      myResponse: {
        id: "person_me",
        userId: "user_me",
        name: "Александр",
        ...responseDraft,
        unavailableTimeOptionIds: [],
      },
    };
    expect(votingDraftFromEvent(existing)).toEqual(responseDraft);
  });

  it("allows a later explicit repeat save after the first completes", async () => {
    const saveResponse = vi.fn(async () => ({ event }));
    const lock = { current: false };
    await saveResponseOnce("evt_real", responseDraft, lock, saveResponse);
    await saveResponseOnce("evt_real", responseDraft, lock, saveResponse);
    expect(saveResponse).toHaveBeenCalledTimes(2);
  });
});

describe("Phase D screen boundaries", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const createdSource = appSource.slice(
    appSource.indexOf("function Created("),
    appSource.indexOf("function ParticipantEvent("),
  );
  const votingSource = appSource.slice(
    appSource.indexOf("function ParticipantEvent("),
    appSource.indexOf("function MyEvents("),
  );

  it("does not fetch event presentation data on Meeting Created", () => {
    expect(createdSource).not.toContain("useEvent(");
    expect(createdSource).not.toContain("api.event");
    expect(createdSource).not.toContain("<BottomNavigation");
  });

  it("keeps decided events on the existing Result component", () => {
    expect(votingSource).toContain(
      "return <Result eventId={eventId} navigate={navigate} initial={event} />",
    );
  });

  it("keeps Loading, Error and Retry handling", () => {
    expect(votingSource).toContain("<Loading");
    expect(votingSource).toContain("<RetryState");
    expect(votingSource).toContain("state.error");
    expect(votingSource).toContain("onRetry={() => void state.load()}");
  });

  it("does not render BottomNavigation or bind form state to theme", () => {
    expect(votingSource).not.toContain("<BottomNavigation");
    expect(votingSource).not.toContain("resolvedTheme");
    expect(votingSource).not.toContain("key={resolvedTheme}");
  });

  it("keeps the existing Telegram MainButton integration", () => {
    expect(votingSource).toContain("useMainButton(");
  });
});
