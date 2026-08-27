import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeMyMeetingsCursor,
  parseMyMeetingsCursor,
  parseMyMeetingsLimit,
  parseMyMeetingsRole,
} from "../supabase/functions/_shared/my-meetings-page";
import { mergeMeetingItems } from "../src/my-meetings";
import type { MeetingListItem } from "../src/types";

const appSource = readFileSync("src/App.tsx", "utf8");
const apiSource = readFileSync("src/api.ts", "utf8");
const backendSource = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const mockSource = readFileSync("src/mock-api.ts", "utf8");

function item(id: string, title = id): MeetingListItem {
  return {
    id,
    title,
    status: "collecting",
    role: "owner",
    participantCount: 1,
    responseCount: 1,
    bestTime: null,
    timeSummary: null,
    placeSummary: null,
    createdAt: "2026-08-28T10:00:00.000Z",
  };
}

describe("My Meetings pagination contract", () => {
  it("uses a bounded default and server maximum", () => {
    expect(parseMyMeetingsLimit(null)).toBe(12);
    expect(parseMyMeetingsLimit("20")).toBe(20);
    expect(parseMyMeetingsLimit("200")).toBe(20);
  });

  it.each(["", "0", "-1", "1.5", "twenty"])("rejects malformed limit %j", (limit) => {
    expect(() => parseMyMeetingsLimit(limit)).toThrow("Некорректный размер страницы.");
  });

  it("accepts only the two existing role streams", () => {
    expect(parseMyMeetingsRole("owner")).toBe("owner");
    expect(parseMyMeetingsRole("participant")).toBe("participant");
    expect(() => parseMyMeetingsRole("all")).toThrow("Некорректный тип встреч.");
  });

  it("round-trips an opaque deterministic composite cursor", () => {
    const value = { createdAt: "2026-08-28T10:00:00.000Z", id: "evt_123" };
    const encoded = encodeMyMeetingsCursor(value);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain(value.createdAt);
    expect(parseMyMeetingsCursor(encoded)).toEqual(value);
  });

  it.each(["not base64!", "eyJjcmVhdGVkQXQiOiJiYWQiLCJpZCI6ImV2dCJ9"])("rejects malformed cursor %s", (cursor) => {
    expect(() => parseMyMeetingsCursor(cursor)).toThrow("Некорректный курсор списка.");
  });

  it("keeps the legacy endpoint for old deployed clients and adds a separate page endpoint", () => {
    expect(backendSource).toContain('path === "/me/meetings") return await meetings(auth)');
    expect(backendSource).toContain('path === "/me/meetings/page") return await meetingListPage(request, auth)');
    expect(apiSource).toContain("meetingsPage: (role: MeetingListItem");
    expect(apiSource).toContain("/me/meetings/page?role=");
  });

  it("uses created_at plus id keyset ordering for both role pages", () => {
    const page = backendSource.slice(
      backendSource.indexOf("async function meetingListPage"),
      backendSource.indexOf("function assertParticipantId"),
    );
    expect(page).toContain('.order("created_at", { ascending: false })');
    expect(page).toContain('.order("id", { ascending: false })');
    expect(page).toContain('created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})');
    expect(page).toContain(".limit(limit + 1)");
  });

  it("keeps organizer and participant filters separate without full event payload calls", () => {
    const page = backendSource.slice(
      backendSource.indexOf("async function meetingListPage"),
      backendSource.indexOf("function assertParticipantId"),
    );
    expect(page).toContain('.eq("owner_user_id", auth.user.id)');
    expect(page).toContain("participants!inner(user_id)");
    expect(page).toContain('.eq("participants.user_id", auth.user.id)');
    expect(page).toContain('.is("deleted_at", null)');
    expect(page).not.toContain("eventPayload(");
  });

  it("builds cards from bounded batched relation reads", () => {
    const page = backendSource.slice(
      backendSource.indexOf("async function meetingListPage"),
      backendSource.indexOf("function assertParticipantId"),
    );
    expect(page).toContain('db.from("time_options").select("id,event_id,starts_at").in("event_id", eventIds)');
    expect(page).toContain('db.from("place_options").select("id,event_id,title").in("event_id", eventIds)');
    expect(page).toContain('db.from("participants").select("id,event_id").in("event_id", eventIds)');
    expect(page).toContain('db.from("availability_votes").select("time_option_id,is_available").in("time_option_id", timeIds)');
  });

  it("deduplicates retries while preserving the existing card order", () => {
    expect(mergeMeetingItems([item("one")], [item("two"), item("one", "updated")])).toEqual([
      item("one", "updated"),
      item("two"),
    ]);
  });

  it("keeps independent tab page state and preserves loaded cards on load-more errors", () => {
    const myEvents = appSource.slice(
      appSource.indexOf("function MyEvents"),
      appSource.indexOf("function Manage"),
    );
    expect(myEvents).toContain("owner: emptyPage()");
    expect(myEvents).toContain("participant: emptyPage()");
    expect(myEvents).toContain("mergeMeetingItems(current[role].items, result.items)");
    expect(myEvents).toContain("selectedPage.error && selectedPage.items.length > 0");
    expect(myEvents).toContain("disabled={selectedPage.loadingMore}");
  });

  it("uses a mock-only second page for rendered load-more QA", () => {
    expect(mockSource).toContain("mockOwnedMeetingPages");
    expect(mockSource).toContain('nextCursor: "mock-owner-page-2"');
  });
});
