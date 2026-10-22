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

  it("dates a decided meeting by its chosen time, not the most popular one", () => {
    const items = [
      meeting("decided", {
        status: "decided",
        bestTime: at("2026-10-16T18:00:00Z"),
        finalTime: at("2026-10-25T18:00:00Z"),
      }),
      meeting("collecting", { bestTime: at("2026-10-20T18:00:00Z") }),
    ];
    expect(nearestMeeting(items, now)?.id).toBe("collecting");
  });

  it("counts the most popular option still ahead, not a popular one already past", () => {
    const items = [
      // The popular option is in the past, but another one is ahead: still a candidate.
      meeting("stale-lead", { bestTime: at("2026-10-10T18:00:00Z"), upcomingTime: at("2026-10-18T18:00:00Z") }),
      meeting("later", { bestTime: at("2026-10-20T18:00:00Z"), upcomingTime: at("2026-10-20T18:00:00Z") }),
      // Every option is past: not a candidate, even though bestTime has a value.
      meeting("over", { bestTime: at("2026-10-12T18:00:00Z"), upcomingTime: null }),
    ];
    expect(nearestMeeting(items, now)?.id).toBe("stale-lead");
    expect(nearestMeeting([items[2]], now)?.id).toBe("over"); // falls back to the latest created
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
