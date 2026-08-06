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
