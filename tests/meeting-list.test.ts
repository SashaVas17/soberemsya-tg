import { describe, expect, it } from "vitest";
import { meetingListItem } from "../supabase/functions/_shared/meeting-list";

const timeOptions = [
  { id: "time_9", startsAt: "2026-08-09T16:00:00.000Z", availableCount: 2 },
  { id: "time_10", startsAt: "2026-08-10T16:00:00.000Z", availableCount: 3 },
];

describe("meeting list summaries", () => {
  it("returns a collecting meeting with a safe date range and response count", () => {
    const item = meetingListItem(
      {
        id: "collecting",
        title: "Шашлыки с друзьями",
        status: "collecting",
        finalPlaceId: null,
        finalTimeOptionId: null,
        timeOptions,
        placeOptions: [{ id: "park", title: "Парк" }],
        participants: [{ id: "first" }, { id: "second" }, { id: "third" }],
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      "owner",
    );

    expect(item).toMatchObject({
      role: "owner",
      responseCount: 3,
      participantCount: 3,
      timeSummary: "9–10 августа",
      placeSummary: null,
      bestTime: timeOptions[1],
    });
  });

  it("returns decided meeting summaries from the chosen existing options", () => {
    const item = meetingListItem(
      {
        id: "decided",
        title: "День рождения",
        status: "decided",
        finalPlaceId: "place_pub",
        finalTimeOptionId: "time_10",
        timeOptions,
        placeOptions: [
          { id: "place_park", title: "Парк" },
          { id: "place_pub", title: "Публика" },
        ],
        participants: [{ id: "first" }],
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      "participant",
    );

    expect(item).toMatchObject({
      role: "participant",
      responseCount: 1,
      timeSummary: "10 августа · 19:00",
      placeSummary: "Публика",
    });
  });

  it("returns null summaries when legacy final option references are missing", () => {
    const item = meetingListItem(
      {
        id: "legacy",
        title: "Встреча",
        status: "decided",
        finalPlaceId: "missing-place",
        finalTimeOptionId: "missing-time",
        timeOptions: [],
        placeOptions: [],
        participants: [],
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      "owner",
    );

    expect(item.timeSummary).toBeNull();
    expect(item.placeSummary).toBeNull();
  });
});
