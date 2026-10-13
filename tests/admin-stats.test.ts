import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AdminStats,
  formatStatsText,
  isAdminTelegramId,
  parseAdminIds,
  parseClientAnalyticsEvent,
  percent,
  startParamSource,
} from "../supabase/functions/_shared/admin-stats";
import { parseStartParam } from "../supabase/functions/_shared/domain";
import { barWidth, shareText, shortDay } from "../src/admin-stats";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261013142231_analytics.sql");
const api = read("supabase/functions/telegram-api/index.ts");
const bot = read("supabase/functions/telegram-bot/index.ts");

const stats: AdminStats = {
  generatedAt: "2026-10-13T12:00:00Z",
  usersTotal: 12,
  usersNew7d: 3,
  activeToday: 4,
  active7d: 9,
  active30d: 11,
  notificationOpens7d: 5,
  meetingsTotal: 21,
  meetings7d: 6,
  responses7d: 17,
  joinRequests7d: 2,
  shares7d: 8,
  returningUsers7d: 5,
  previousWeekUsers: 8,
  meetings30d: 14,
  meetingsWithResponses30d: 0,
  daily: [],
};

describe("administrators", () => {
  it("defaults to the owner and parses a list", () => {
    expect(parseAdminIds(undefined)).toEqual(new Set(["1979217645"]));
    expect(parseAdminIds("1, 2 ,x")).toEqual(new Set(["1", "2"]));
    expect(isAdminTelegramId("1979217645", parseAdminIds(undefined))).toBe(true);
    expect(isAdminTelegramId(1979217645, parseAdminIds(undefined))).toBe(true);
    expect(isAdminTelegramId("42", parseAdminIds(undefined))).toBe(false);
    expect(isAdminTelegramId(null, parseAdminIds(undefined))).toBe(false);
  });

  it("hides stats from everyone else", () => {
    const handler = api.slice(api.indexOf("async function adminStats"), api.indexOf("function apiPath("));
    expect(handler.indexOf("isAdminTelegramId(")).toBeLessThan(handler.indexOf('db.rpc("admin_stats")'));
    expect(handler).toContain('json({ error: "Маршрут не найден." }, 404)');
    expect(bot).toContain('command === "/stats" && isAdminTelegramId(message.senderId, adminIds)');
  });
});

describe("analytics events", () => {
  it("labels where an app open came from", () => {
    expect(startParamSource(null)).toBe("direct");
    expect(startParamSource("ntf")).toBe("notification");
    expect(startParamSource("ntf_evt_1")).toBe("notification");
    expect(startParamSource("event_evt_1")).toBe("event");
    expect(startParamSource("group_AbCdEfGhIjKlMnOpQrStUv_-")).toBe("group");
  });

  it("opens the meeting from a notification button", () => {
    expect(parseStartParam("ntf_evt_1")).toEqual({ type: "event", eventId: "evt_1" });
    expect(parseStartParam("ntf")).toEqual({ type: "home" });
    expect(() => parseStartParam("ntf_")).toThrow("Некорректная");
  });

  it("accepts only whitelisted client events", () => {
    expect(parseClientAnalyticsEvent({ name: "share_sent", eventId: "evt_1" })).toEqual({ name: "share_sent", eventId: "evt_1" });
    expect(() => parseClientAnalyticsEvent({ name: "app_open" })).toThrow();
    expect(() => parseClientAnalyticsEvent({ name: "share_sent", eventId: "../x" })).toThrow();
  });

  it("records server events after the change succeeds", () => {
    expect(api).toContain('if (!replayed) await track("meeting_created"');
    expect(api).toContain('if (result.status === 201) await track("join_requested"');
    expect(api).toContain('await track("response_saved", auth.user.id, eventId);');
  });

  it("keeps analytics server-only", () => {
    expect(migration).toContain("alter table public.analytics_events enable row level security;");
    expect(migration).toContain("revoke all privileges on table public.analytics_events from public, anon, authenticated;");
    expect(migration).toContain("revoke all on function public.admin_stats() from public, anon, authenticated;");
  });
});

describe("stats formatting", () => {
  it("formats the bot summary", () => {
    const text = formatStatsText(stats);
    expect(text).toContain("Активные: сегодня 4, за 7 дней 9, за 30 дней 11");
    expect(text).toContain("Вернулись за 7 дней: 63% (5 из 8)");
    expect(text).toContain("Встречи с ответами (30 дней): 0% (0 из 14)");
    expect(percent(1, 0)).toBeNull();
  });

  it("formats the admin screen", () => {
    expect(shareText(5, 8)).toBe("63% (5 из 8)");
    expect(shareText(0, 0)).toBe("нет данных");
    expect(shortDay("2026-10-03")).toBe("03.10");
    const daily = [{ day: "a", active: 2, meetings: 0, responses: 0 }, { day: "b", active: 4, meetings: 0, responses: 0 }];
    expect(barWidth(2, daily)).toBe(50);
    expect(barWidth(0, [])).toBe(0);
  });
});
