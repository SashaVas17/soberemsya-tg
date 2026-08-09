import { describe, expect, it } from "vitest";
import { assertEventAvailable, assertOwner, assertVotingOpen, parseEventStartParam, participantIdentityKey } from "../supabase/functions/_shared/domain";
import { buildIcs, escapeIcs } from "../supabase/functions/_shared/calendar";

describe("meeting authorization guards", () => {
  it("uses event and Telegram user together for a repeat response", () => {
    expect(participantIdentityKey("evt_1", "user_1")).toBe(participantIdentityKey("evt_1", "user_1"));
    expect(participantIdentityKey("evt_1", "user_1")).not.toBe(participantIdentityKey("evt_1", "user_2"));
  });

  it("rejects management by another Telegram user", () => {
    expect(() => assertOwner("owner_1", "owner_2")).toThrow("нет доступа");
  });

  it("rejects an invalid startapp payload", () => {
    expect(() => parseEventStartParam("manage_SECRET")).toThrow("Некорректная");
  });

  it("rejects a deleted meeting", () => {
    expect(() => assertEventAvailable({ deleted_at: new Date().toISOString() })).toThrow("удалена");
  });

  it("blocks responses after voting is closed", () => {
    expect(() => assertVotingOpen("decided")).toThrow("закрыт");
  });

  it("creates a standards-friendly UTF-8 calendar event", () => {
    const ics = buildIcs({ id: "evt_1", title: "Встреча, друзья", description: "Парк\nВозьмите воду", location: "Минск; Центр", url: "https://t.me/test", startsAt: "2026-08-15T16:00:00.000Z" });
    expect(ics).toContain("\r\n");
    expect(ics).toContain("SUMMARY:Встреча\\, друзья");
    expect(ics).toContain("LOCATION:Минск\\; Центр");
    expect(ics).toContain("DTSTART:20260815T160000Z");
    expect(ics).toContain("DTEND:20260815T180000Z");
    expect(escapeIcs("a\\b")).toBe("a\\\\b");
  });
});
