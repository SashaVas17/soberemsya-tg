import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isSessionExpiredStatus,
  notifySessionExpired,
  onSessionExpired,
} from "../src/session";

describe("session expiry signal", () => {
  it("treats only 401 as an expired Telegram session", () => {
    expect(isSessionExpiredStatus(401)).toBe(true);
    for (const status of [400, 403, 404, 409, 500]) expect(isSessionExpiredStatus(status)).toBe(false);
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
    expect(request.indexOf("notifySessionExpired()"))
      .toBeLessThan(request.indexOf("throw apiErrorFromBody"));
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
