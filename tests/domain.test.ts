import { describe, expect, it } from "vitest";
import { assertEventAvailable, assertOwner, assertVotingOpen, parseEventStartParam, participantIdentityKey } from "../supabase/functions/_shared/domain";

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
});
