import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edgeApi = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260805171807_telegram_mini_app_identity.sql", "utf8");
const frontend = readFileSync("src/App.tsx", "utf8");

describe("Telegram Mini App architecture", () => {
  it("enforces one participant per event and Telegram user", () => {
    expect(migration).toContain("unique (event_id, user_id)");
    expect(edgeApi).toMatch(/eq\("event_id", eventId\)\.eq\("user_id", auth\.user\.id\)/);
  });

  it("checks organizer ownership on server mutations", () => {
    expect(edgeApi).toContain("assertOwner(event.owner_user_id, auth.user.id)");
  });

  it("keeps place votes tied to a participant and requires closed collection before a decision", () => {
    expect(edgeApi).toContain('db.from("place_votes").delete().eq("participant_id", participantId)');
    expect(edgeApi).toContain('payload.action === "decide" && event.status !== "place_selection"');
  });

  it("uses a signed HTTPS calendar link instead of a Blob download", () => {
    expect(edgeApi).toContain("calendarLink");
    expect(edgeApi).toContain("TELEGRAM_CALENDAR_SIGNING_SECRET");
    expect(frontend).toContain("calendarLink(event.id)");
    expect(frontend).not.toContain("URL.createObjectURL");
  });

  it("does not let an unavailable place-votes relation break event reads or responses", () => {
    expect(edgeApi).toContain("isMissingPlaceVotesRelation");
    expect(edgeApi).toContain("placeVotingEnabled = !placeVoteResult.error");
    expect(edgeApi).toContain("placeVotingEnabled = !placeVoteProbe.error");
    expect(frontend).toContain("event.placeVotingEnabled && event.placeOptions.length");
  });

  it("does not trust initDataUnsafe or use Next API routes", () => {
    expect(frontend).not.toContain("initDataUnsafe");
    expect(frontend).not.toContain("/api/");
    expect(edgeApi).toContain("validateTelegramInitData");
  });

  it("checks backend health before Telegram authentication", () => {
    expect(edgeApi).toContain('path === "/health"');
    expect(edgeApi).toContain('status: "ok"');
    expect(edgeApi).toContain("telegram_auth_validation_failed");
  });
});
