import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  classifyTelegramResult,
  eventDeepLink,
  formatMeetingTime,
  isNotificationStale,
  notificationLink,
  type NotificationKind,
  renderNotification,
} from "../supabase/functions/_shared/notification-messages";
import {
  notificationSettingsResponse,
  parseNotificationSettingsUpdate,
} from "../supabase/functions/_shared/notification-settings";
import { askWriteAccessOnce, WRITE_ACCESS_ASKED_KEY } from "../src/write-access";
import { readAppSource } from "./app-source";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationNames = readdirSync("supabase/migrations").filter((name) => name >= "2026101313");
const migrations = Object.fromEntries(migrationNames.map((name) => [name, read(`supabase/migrations/${name}`)]));
const allSql = Object.values(migrations).join("\n");
const url = eventDeepLink("bot", "app", "evt_1");
const kinds: NotificationKind[] = [
  "response_each", "response_summary", "join_request_new", "join_request_approved",
  "join_request_rejected", "event_decided", "event_cancelled", "event_updated",
  "event_reopened", "reminder_24h", "reminder_2h",
];

describe("notification messages", () => {
  it("renders every kind with a deep link and a neutral, title-quoted text", () => {
    for (const kind of kinds) {
      const message = renderNotification(kind, { title: "Шашлыки" }, url);
      expect(message.text).toContain("«Шашлыки»");
      expect(message.url).toBe("https://t.me/bot/app?startapp=event_evt_1");
      expect(message.buttonText.length).toBeGreaterThan(0);
    }
  });

  it("includes counts in summaries and details in decisions and reminders", () => {
    expect(renderNotification("response_summary", { title: "X", answered: 5, available: 4, declined: 1 }, url).text)
      .toBe("Встреча «X»: ответили 5. Самое удобное время подходит 4, не подходит 1.");
    const decided = renderNotification("event_decided",
      { title: "X", startsAt: "2030-06-01T15:00:00Z", place: "Парк", area: "Центр" }, url).text;
    expect(decided).toContain("18:00");
    expect(decided).toContain("Парк, Центр");
    expect(renderNotification("reminder_2h", { title: "X" }, url).text).toBe("Через 2 часа встреча «X».");
  });

  it("formats meeting time in Minsk time", () => {
    expect(formatMeetingTime("2030-06-01T15:00:00Z")).toMatch(/1 июня.*18:00/);
    expect(formatMeetingTime("not a date")).toBe("");
  });

  it("falls back to the app link without an event and for a rejection", () => {
    expect(eventDeepLink("bot", "app", null)).toBe("https://t.me/bot/app");
    expect(notificationLink("bot", "app", "join_request_rejected", "evt_1")).toBe("https://t.me/bot/app?startapp=ntf");
    expect(notificationLink("bot", "app", "event_decided", "evt_1")).toBe("https://t.me/bot/app?startapp=ntf_evt_1");
  });

  it("skips stale notifications but still delivers a cancellation", () => {
    expect(isNotificationStale("reminder_24h", "cancelled", false)).toBe(true);
    expect(isNotificationStale("reminder_24h", "decided", true)).toBe(true);
    expect(isNotificationStale("event_cancelled", "cancelled", false)).toBe(false);
    expect(isNotificationStale("event_decided", "decided", false)).toBe(false);
  });

  it("maps Telegram results to outbox outcomes", () => {
    expect(classifyTelegramResult(200, { ok: true })).toEqual({ outcome: "sent" });
    expect(classifyTelegramResult(429, { ok: false, parameters: { retry_after: 7 } }))
      .toMatchObject({ outcome: "retry", retryAfterSeconds: 7 });
    expect(classifyTelegramResult(403, { ok: false, description: "bot was blocked" }).outcome).toBe("blocked");
    expect(classifyTelegramResult(502, null).outcome).toBe("retry");
    expect(classifyTelegramResult(400, { ok: false }).outcome).toBe("failed");
  });
});

describe("notification settings", () => {
  it("defaults to summary mode with both reminders on", () => {
    expect(notificationSettingsResponse(null, null)).toEqual({
      responseMode: "summary", reminder24h: true, reminder2h: true, canMessage: null,
    });
  });

  it("parses partial updates and rejects invalid ones with 400", () => {
    expect(parseNotificationSettingsUpdate({ responseMode: "each" })).toEqual({
      preferences: { response_mode: "each" }, writeAccessGranted: false,
    });
    expect(parseNotificationSettingsUpdate({ reminder2h: false, writeAccessGranted: true })).toEqual({
      preferences: { reminder_2h: false }, writeAccessGranted: true,
    });
    for (const bad of [{}, { responseMode: "loud" }, { reminder24h: "yes" }, { writeAccessGranted: 1 }])
      expect(() => parseNotificationSettingsUpdate(bad)).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe("write access prompt", () => {
  const storage = () => {
    const data = new Map<string, string>();
    return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  };

  it("asks once and reports only a grant", async () => {
    const store = storage();
    const report = vi.fn(async () => undefined);
    await expect(askWriteAccessOnce(report, async () => true, store)).resolves.toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(store.data.get(WRITE_ACCESS_ASKED_KEY)).toBe("1");
    await expect(askWriteAccessOnce(report, async () => true, store)).resolves.toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("asks again later when this client cannot ask", async () => {
    const store = storage();
    const report = vi.fn(async () => undefined);
    await expect(askWriteAccessOnce(report, async () => null, store)).resolves.toBeNull();
    expect(store.data.has(WRITE_ACCESS_ASKED_KEY)).toBe(false);
    await expect(askWriteAccessOnce(report, async () => true, store)).resolves.toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("does not report a refusal", async () => {
    const report = vi.fn(async () => undefined);
    await askWriteAccessOnce(report, async () => false, storage());
    expect(report).not.toHaveBeenCalled();
  });
});

describe("notification migrations", () => {
  it("locks every new table away from browser roles", () => {
    for (const table of ["notification_preferences", "notification_outbox", "event_notification_state"]) {
      expect(allSql).toContain(`alter table public.${table} enable row level security;`);
      expect(allSql).toContain(`revoke all privileges on table public.${table} from public, anon, authenticated;`);
    }
  });

  it("keeps the outbox kinds in sync with the renderer", () => {
    for (const kind of kinds) expect(migrations["20261013130744_notifications_schema.sql"]).toContain(`'${kind}'`);
  });

  it("hardens every new function and revokes it from browser roles", () => {
    const functions = [...allSql.matchAll(/create or replace function public\.(\w+)\(/g)].map((match) => match[1]);
    expect(functions.length).toBeGreaterThanOrEqual(10);
    for (const name of functions) {
      expect(allSql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    }
    expect(allSql.match(/security definer set search_path = pg_catalog, public/g)?.length).toBe(functions.length);
  });

  // ALTER TABLE ... DROP CONSTRAINT passed the connector on 2026-10-14.
  it("never uses DROP statements other than DROP CONSTRAINT (the Supabase connector hangs on them)", () => {
    expect(allSql).not.toMatch(/^\s*drop\s+(?!constraint\b)/im);
  });

  it("never combines RAISE and DELETE in one function body (Supabase connector limitation)", () => {
    for (const body of allSql.split(/\$\$;/)) {
      expect(/\braise\b/i.test(body) && /\bdelete\s+from\b/i.test(body)).toBe(false);
    }
  });

  it("has at most one DELETE per function body (Supabase connector limitation)", () => {
    for (const body of allSql.split(/\$\$;/)) {
      expect(body.match(/\bdelete\s+from\b/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("notifies on a re-decision, never drops an each-mode response, and counts real answers", () => {
    const triggers = migrations["20261013131123_notification_triggers.sql"];
    expect(triggers).toContain("after update of status, title, description, final_time_option_id, final_place_id on public.events");
    expect(triggers).toContain("or new.final_time_option_id is distinct from old.final_time_option_id");
    expect(triggers).toContain("to_timestamp((v_bucket + 1) * 900)");
    expect(triggers).toContain("public.event_answered_count(v_row.id, v_row.owner_user_id)");
    expect(migrations["20261013131145_notification_scheduler.sql"]).toContain("and voter.user_id is distinct from v_row.owner_user_id");
  });

  it("does not spend attempts on throttled messages", () => {
    expect(migrations["20261013131208_notification_worker_rpc.sql"]).toContain("elsif p_outcome = 'defer' then");
    expect(read("supabase/functions/notifications-worker/index.ts")).toContain('await complete(item.id, "defer", "throttled", throttledFor);');
  });

  it("generates the worker secret in the database, never in the repository", () => {
    const rpc = migrations["20261013131208_notification_worker_rpc.sql"];
    expect(rpc).toContain("encode(extensions.gen_random_bytes(32), 'hex')");
    expect(rpc).toContain("grant execute on function public.verify_notifications_worker_secret(text) to service_role;");
  });
});

describe("API and UI wiring", () => {
  const api = read("supabase/functions/telegram-api/index.ts");
  const app = readAppSource();

  it("exposes notification settings and a cancel action", () => {
    expect(api).toContain('if (path === "/me/notification-settings") return ["GET", "PUT"];');
    expect(api).toContain('case "cancel":');
    expect(api).toContain('case "reopen": { if (event.status === "cancelled")');
    expect(api).toContain('case "decide": { if (event.status === "cancelled")');
    expect(read("supabase/functions/_shared/http.ts")).toContain('"GET, POST, PUT, PATCH, DELETE, OPTIONS"');
  });

  it("asks for write access after creating a meeting and after answering", () => {
    expect(app.match(/askWriteAccessOnce\(\(\) => api\.notificationSettings\(\{ writeAccessGranted: true \}\)\)/g))
      .toHaveLength(2);
  });

  it("routes the settings screen", () => {
    expect(app).toContain('if (path === "/settings") return <NotificationSettingsScreen');
  });
});
