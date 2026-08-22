import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edgeApi = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260806080232_telegram_mini_app_identity.sql", "utf8");
const frontend = readFileSync("src/App.tsx", "utf8");
const frontendApi = readFileSync("src/api.ts", "utf8");

describe("Telegram Mini App architecture", () => {
  it("enforces one participant per event and Telegram user", () => {
    expect(migration).toContain("unique (event_id, user_id)");
    expect(edgeApi).toContain('db.rpc("save_event_response"');
  });

  it("checks organizer ownership on server mutations", () => {
    expect(edgeApi).toContain("assertOwner(event.owner_user_id, auth.user.id)");
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

  it("keeps signed calendar links outside the frontend and requires the current access guard", () => {
    expect(edgeApi).toContain("calendarLink");
    expect(edgeApi).toContain("calendarDownload");
    expect(edgeApi).toContain("fullEventForRequest(eventId, auth.user.id)");
    expect(frontendApi).toContain("calendarLink");
    expect(frontendApi).not.toContain("TELEGRAM_CALENDAR_SIGNING_SECRET");
    expect(frontend).not.toContain("navigator.share");
  });
});
