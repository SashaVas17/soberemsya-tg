import { describe, expect, it } from "vitest";
import { nearestMeeting } from "../src/my-meetings";
import type { MeetingListItem } from "../src/types";

const now = new Date("2026-10-15T12:00:00Z");

const meeting = (id: string, patch: Partial<MeetingListItem> = {}): MeetingListItem => ({
  id,
  title: id,
  status: "collecting",
  role: "owner",
  participantCount: 1,
  responseCount: 0,
  bestTime: null,
  timeSummary: null,
  placeSummary: null,
  createdAt: "2026-10-01T10:00:00Z",
  ...patch,
});

const at = (startsAt: string) => ({ id: "t", startsAt, availableCount: 1 });

describe("nearestMeeting", () => {
  it("returns null without meetings", () => {
    expect(nearestMeeting([], now)).toBeNull();
  });

  it("picks the soonest upcoming meeting, ignoring past ones", () => {
    const items = [
      meeting("past", { bestTime: at("2026-10-10T18:00:00Z") }),
      meeting("later", { bestTime: at("2026-10-20T18:00:00Z") }),
      meeting("soon", { bestTime: at("2026-10-16T18:00:00Z") }),
    ];
    expect(nearestMeeting(items, now)?.id).toBe("soon");
  });

  it("falls back to the latest created active meeting when no time is ahead", () => {
    const items = [
      meeting("old", { createdAt: "2026-09-01T10:00:00Z" }),
      meeting("new", { createdAt: "2026-10-12T10:00:00Z" }),
    ];
    expect(nearestMeeting(items, now)?.id).toBe("new");
  });

  it("never picks a cancelled meeting", () => {
    const items = [
      meeting("cancelled", { status: "cancelled", bestTime: at("2026-10-16T18:00:00Z") }),
      meeting("open", { createdAt: "2026-09-01T10:00:00Z" }),
    ];
    expect(nearestMeeting(items, now)?.id).toBe("open");
    expect(nearestMeeting([items[0]], now)).toBeNull();
  });
});
