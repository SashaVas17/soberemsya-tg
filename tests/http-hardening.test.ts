import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserCorsHeaders,
  browserPreflightResponse,
  withBrowserCors,
} from "../supabase/functions/_shared/http.ts";

const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const bot = readFileSync("supabase/functions/telegram-bot/index.ts", "utf8");
const http = readFileSync("supabase/functions/_shared/http.ts", "utf8");

describe("Edge Function HTTP hardening", () => {
  it("allows only the exact browser origins", () => {
    expect(browserCorsHeaders("https://sashavas17.github.io")?.["access-control-allow-origin"])
      .toBe("https://sashavas17.github.io");
    expect(browserCorsHeaders("http://localhost:5173")).not.toBeNull();
    expect(browserCorsHeaders("http://127.0.0.1:5173")).not.toBeNull();
    expect(browserCorsHeaders("https://evil.github.io")).toBeNull();
    expect(browserCorsHeaders("https://sashavas17.github.io.attacker.example")).toBeNull();
    expect(browserCorsHeaders("https://sashavas17.github.io/soberemsya-tg/")).toBeNull();
  });

  it("returns exact CORS preflight headers without credentials", async () => {
    const response = browserPreflightResponse(new Request("https://example.test", {
      method: "OPTIONS",
      headers: { origin: "https://sashavas17.github.io" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("apikey, content-type, x-telegram-init-data");
    expect(response.headers.get("access-control-max-age")).toBe("600");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    const rejected = browserPreflightResponse(new Request("https://example.test", {
      method: "OPTIONS", headers: { origin: "https://attacker.example" },
    }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
    expect((await rejected.json()).error).toBe("Доступ запрещён.");
  });

  it("adds CORS to allowed-origin API errors only", () => {
    const allowed = withBrowserCors(
      new Request("https://example.test", { headers: { origin: "https://sashavas17.github.io" } }),
      Response.json({ error: "safe" }, { status: 401 }),
    );
    const rejected = withBrowserCors(
      new Request("https://example.test", { headers: { origin: "https://attacker.example" } }),
      Response.json({ error: "safe" }, { status: 401 }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://sashavas17.github.io");
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps health static and calendar downloads outside browser CORS", () => {
    expect(api).toContain("return json({ ok: true });");
    expect(api).not.toContain("databaseSecretLooksValid");
    expect(api).not.toContain("...corsHeaders");
    expect(api).toContain("return path !== \"/health\" && !/^\\/calendar\\/[^/]+$/.test(path);");
  });

  it("makes the webhook POST-only without browser CORS", () => {
    expect(bot).toContain('if (request.method !== "POST")');
    expect(bot).toContain('{ allow: "POST" }');
    expect(bot).not.toContain("corsHeaders");
    expect(bot.indexOf('if (request.method !== "POST")')).toBeLessThan(bot.indexOf("request.json()"));
  });

  it("removes wildcard CORS and leaves auth server-side", () => {
    expect(http).not.toContain('"access-control-allow-origin": "*"');
    expect(api).toContain("validateTelegramInitData");
    expect(api).toContain("browserPreflightResponse(request)");
  });
});
