import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const bot = readFileSync("supabase/functions/telegram-bot/index.ts", "utf8");
const boundedJson = readFileSync("supabase/functions/_shared/bounded-json.ts", "utf8");
const http = readFileSync("supabase/functions/_shared/http.ts", "utf8");

describe("bounded request handling contracts", () => {
  it("defines central 8 KiB, 32 KiB, and 256 KiB limits", () => {
    expect(boundedJson).toContain("TELEGRAM_AUTH_BODY_LIMIT_BYTES = 8 * 1024");
    expect(boundedJson).toContain("API_JSON_BODY_LIMIT_BYTES = 32 * 1024");
    expect(boundedJson).toContain("TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024");
  });

  it("uses bounded parsing for every production JSON route", () => {
    expect(api).toContain("readJsonObject(request, TELEGRAM_AUTH_BODY_LIMIT_BYTES)");
    expect(api).toContain("readJsonObject(request, API_JSON_BODY_LIMIT_BYTES)");
    expect(api).not.toContain("request.json()");
    expect(bot).toContain("readJsonObject(request, TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES)");
    expect(bot).not.toContain("request.json()");
  });

  it("keeps authenticated API parsing after Telegram auth and webhook parsing after its secret gate", () => {
    const saveResponse = api.slice(api.indexOf("async function saveResponse"), api.indexOf("async function leaveParticipation"));
    expect(api.indexOf("const auth = await authenticate(request);")).toBeLessThan(
      api.indexOf("return await createEvent(request, auth)"),
    );
    expect(saveResponse).toContain("readJsonObject(request, API_JSON_BODY_LIMIT_BYTES)");
    expect(bot.indexOf("x-telegram-bot-api-secret-token")).toBeLessThan(
      bot.indexOf("readJsonObject(request, TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES)"),
    );
  });

  it("enforces the known field, array, and int32 budget limits", () => {
    expect(api).toContain('textField(payload, "title", 200');
    expect(api).toContain('textField(payload, "description", 4_000');
    expect(api).toContain('textField(payload, "preferences", 4_000');
    expect(api).toContain('textField(payload, "restrictions", 4_000');
    expect(api).toContain('textField(payload, "area", 200');
    expect(api).toContain("value.length > 50");
    expect(api).toContain("budget > 2_147_483_647");
  });

  it("preserves CORS, health, calendar, and POST-only webhook behavior", () => {
    expect(http).toContain('"https://sashavas17.github.io"');
    expect(api).toContain("return json({ ok: true });");
    expect(api).toContain('"content-type": "text/calendar; charset=utf-8"');
    expect(bot).toContain('if (request.method !== "POST")');
    expect(bot.indexOf('if (request.method !== "POST")')).toBeLessThan(
      bot.indexOf("const update = await readJsonObject"),
    );
  });

  it("does not add rate limiting or log raw bodies", () => {
    expect(boundedJson).not.toContain("console.");
    expect(api).not.toContain("Retry-After");
    expect(api).not.toContain("rateLimit");
    expect(bot).not.toContain("Retry-After");
  });
});
