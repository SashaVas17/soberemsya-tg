import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api-error";
import {
  isSessionExpiredError,
  notifySessionExpired,
  onSessionExpired,
} from "../src/session";
import { applicationError } from "../supabase/functions/_shared/errors";
import { errorResponse } from "../supabase/functions/_shared/http";
import {
  TELEGRAM_INIT_DATA_EXPIRED,
  validateTelegramInitData,
} from "../supabase/functions/_shared/telegram";

describe("session expiry signal", () => {
  it("treats only a 401 with the expired-session code as an expired session", () => {
    expect(isSessionExpiredError(new ApiError("x", 401, "TELEGRAM_SESSION_EXPIRED"))).toBe(true);
    expect(isSessionExpiredError(new ApiError("x", 401))).toBe(false);
    expect(isSessionExpiredError(new ApiError("x", 403, "TELEGRAM_SESSION_EXPIRED"))).toBe(false);
    expect(isSessionExpiredError(new Error("x"))).toBe(false);
  });

  it("returns the expired-session code to the client from the API", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(applicationError("TELEGRAM_SESSION_EXPIRED", 401, "reopen"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "reopen", code: "TELEGRAM_SESSION_EXPIRED" });
  });

  it("raises the shared expiry message only for stale auth_date", async () => {
    await expect(validateTelegramInitData("hash=" + "0".repeat(64), "token"))
      .rejects.toThrow("Invalid Telegram signature");
    await expect(validateTelegramInitData("", "token")).rejects.not.toThrow(TELEGRAM_INIT_DATA_EXPIRED);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    notifySessionExpired();
    unsubscribe();
    notifySessionExpired();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("session expiry wiring", () => {
  const api = readFileSync("src/api.ts", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const shell = app.slice(app.indexOf("export default function App()"));

  it("signals expiry from the shared request helper before throwing", () => {
    const request = api.slice(api.indexOf("async function request"), api.indexOf("export const api"));
    expect(request).toContain("if (isSessionExpiredError(error)) notifySessionExpired();");
    expect(request.indexOf("notifySessionExpired()")).toBeLessThan(request.indexOf("throw error;"));
  });

  it("propagates body-read failures on success instead of returning an empty object", () => {
    const request = api.slice(api.indexOf("async function request"), api.indexOf("export const api"));
    expect(request).toContain("if (response.ok) return (await response.json()) as T;");
  });

  it("maps only the stale-initData failure to the expired-session code on the server", () => {
    const server = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
    const auth = server.slice(server.indexOf("async function authenticate"), server.indexOf("async function health"));
    expect(auth).toContain("error.message === TELEGRAM_INIT_DATA_EXPIRED");
    expect(auth).toContain('applicationError("TELEGRAM_SESSION_EXPIRED", 401, message)');
  });

  it("replaces every screen with the reopen prompt, which closes the Mini App", () => {
    expect(shell).toContain("useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);");
    expect(shell.indexOf("if (sessionExpired) return <SessionExpired />;"))
      .toBeLessThan(shell.indexOf("if (error)"));
    const screen = app.slice(app.indexOf("function SessionExpired()"), app.indexOf("function OutsideTelegram()"));
    expect(screen).toContain("Сессия Telegram устарела");
    expect(screen).toContain("app.close()");
    expect(screen).not.toContain("Попробовать снова");
  });
});
