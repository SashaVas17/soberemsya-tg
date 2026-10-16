import { describe, expect, it } from "vitest";
import { signTelegramInitData, validateTelegramInitData } from "../supabase/functions/_shared/telegram";

const token = "123456:TEST_BOT_TOKEN";
const now = 1_800_000_000;

async function validData(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({ auth_date: String(now), query_id: "query-1", user: JSON.stringify({ id: 1001, first_name: "Анна", username: "anna" }), ...overrides });
  params.set("hash", await signTelegramInitData(params, token));
  return params.toString();
}

describe("Telegram Mini App initData", () => {
  it("accepts a valid Telegram signature", async () => {
    const result = await validateTelegramInitData(await validData({ start_param: "event_evt_123" }), token, { now });
    expect(result.user.id).toBe(1001);
    expect(result.startParam).toBe("event_evt_123");
  });

  it("rejects expired auth_date", async () => {
    const raw = await validData({ auth_date: String(now - 3601) });
    await expect(validateTelegramInitData(raw, token, { now, maxAgeSeconds: 3600 })).rejects.toThrow("expired");
  });

  it("rejects a forged Telegram user id", async () => {
    const params = new URLSearchParams(await validData());
    params.set("user", JSON.stringify({ id: 9999, first_name: "Подделка" }));
    await expect(validateTelegramInitData(params.toString(), token, { now })).rejects.toThrow("signature");
  });
});
