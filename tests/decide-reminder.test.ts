import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNotificationStale, renderNotification } from "../supabase/functions/_shared/notification-messages";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_decide_reminder.sql"));
const migration = read(`supabase/migrations/${migrationName}`);
const scheduler = read("supabase/migrations/20261013131145_notification_scheduler.sql");

describe("reminder to pick the result", () => {
  it("tells the organizer the nearest option and how many answered", () => {
    const message = renderNotification(
      "decide_reminder",
      { title: "Кофе", startsAt: "2026-10-24T15:00:00Z", answered: 3 },
      "u",
    );
    expect(message.text).toContain("Встреча «Кофе»: итог ещё не выбран, а ближайший вариант — ");
    expect(message.text).toContain("18:00");
    expect(message.text).toContain("Ответили: 3. Выберите время и место.");
    expect(message.buttonText).toBe("Выбрать итог");
    expect(renderNotification("decide_reminder", { title: "Coffee", startsAt: "2026-10-24T15:00:00Z", answered: 1 }, "u", "en").text)
      .toContain("Answered: 1. Pick the time and place.");
  });

  it("is dropped once the result is picked or the meeting is gone", () => {
    expect(isNotificationStale("decide_reminder", "collecting", false)).toBe(false);
    expect(isNotificationStale("decide_reminder", "decided", false)).toBe(true);
    expect(isNotificationStale("decide_reminder", "cancelled", false)).toBe(true);
    expect(isNotificationStale("decide_reminder", "collecting", true)).toBe(true);
  });

  it("is queued once per meeting, a day before its nearest option, by the minute scheduler", () => {
    expect(migration).toContain("'report_new', 'event_repeated', 'decide_reminder'");
    expect(migration).toContain("'decide_reminder:' || event.id");
    expect(migration).toContain("option.starts_at > p_now");
    expect(migration).toContain("nearest.starts_at <= p_now + interval '24 hours'");
    expect(migration).toContain("event.created_at <= p_now - interval '3 hours'");
    expect(migration).toContain("public.notification_response_mode(event.owner_user_id) <> 'off'");
    expect(migration).toContain("perform public.enqueue_decide_reminders(p_now);");
    expect(migration).toContain("revoke all on function public.enqueue_decide_reminders(timestamptz) from public, anon, authenticated;");
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration.match(/\bdrop\b/gi)).toHaveLength(1);
  });

  it("keeps the rest of the scheduler exactly as it was", () => {
    const start = scheduler.indexOf("create or replace function public.enqueue_due_notifications");
    const original = scheduler.slice(start, scheduler.indexOf("$$;", start) + 3);
    const redefined = migration.slice(migration.indexOf("create or replace function public.enqueue_due_notifications"));
    const withoutCall = redefined.replace(
      / {2}-- The organizer of a meeting[\s\S]*?perform public\.enqueue_decide_reminders\(p_now\);\n\n/,
      "",
    );
    expect(withoutCall.startsWith(original)).toBe(true);
  });
});
