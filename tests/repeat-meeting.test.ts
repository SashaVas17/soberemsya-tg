import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderNotification } from "../supabase/functions/_shared/notification-messages";
import { parseRepeatOf, repeatErrorToken } from "../supabase/functions/_shared/repeat-meeting";
import { repeatTemplate } from "../src/repeat-meeting";
import type { EventData } from "../src/types";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_repeat_meeting.sql"));
const migration = read(`supabase/migrations/${migrationName}`);
const api = read("supabase/functions/telegram-api/index.ts");
const result = read("src/screens/Result.tsx");

const event = {
  id: "evt_old",
  title: "Кофе",
  description: "По пятницам",
  budgetLimit: 25,
  visibility: "private",
  maxParticipants: null,
  status: "decided",
  finalPlaceId: "place_b",
  finalTimeOptionId: "time_a",
  category: { id: "coffee", name: "Кофе" },
  timeOptions: [{ id: "time_a", startsAt: "2026-10-20T15:00:00Z", availableCount: 3 }],
  placeOptions: [
    { id: "place_a", title: "Зерно", area: "Центр", estimatedBudget: 15 },
    { id: "place_b", title: "Ратуша", area: "Немига", estimatedBudget: 20 },
  ],
  participants: [],
  canManage: true,
  myResponse: null,
} as EventData;

describe("«Собрать ещё раз»", () => {
  it("fills the wizard from the meeting: the chosen place first, no dates", () => {
    const template = repeatTemplate(event);
    expect(template).toMatchObject({
      sourceEventId: "evt_old",
      title: "Кофе",
      description: "По пятницам",
      budgetLimit: 25,
      visibility: "private",
      maxParticipants: null,
      categoryId: "coffee",
    });
    expect(template.places.map((place) => place.title)).toEqual(["Ратуша", "Зерно"]);
    expect(template.places[0]).toEqual({ title: "Ратуша", area: "Немига", estimatedBudget: "20" });
    expect(template).not.toHaveProperty("timeOptions");
  });

  it("shows the button only to the organizer of a decided meeting", () => {
    expect(result).toContain('event.canManage && event.status === "decided"');
    expect(result).toContain("startRepeatMeeting(event)");
  });

  it("accepts only a meeting id and logs only its own error tokens", () => {
    expect(parseRepeatOf(undefined)).toBeNull();
    expect(parseRepeatOf("evt_123456789abc")).toBe("evt_123456789abc");
    expect(() => parseRepeatOf("evt 1; drop")).toThrow("Некорректная встреча");
    expect(() => parseRepeatOf(42)).toThrow("Некорректная встреча");
    expect(repeatErrorToken({ code: "P0001", message: "RATE_LIMITED:event_repeat" })).toBe("RATE_LIMITED:event_repeat");
    expect(repeatErrorToken({ code: "P0001", message: "something else" })).toBe("unknown");
    expect(repeatErrorToken({ code: "42501", message: "permission denied for table x" })).toBe("unknown");
  });

  it("never fails the create because of the invitations", () => {
    expect(api).toContain("const repeatOf = parseRepeatOf(payload.repeatOf);");
    expect(api).toMatch(/async function invitePreviousParticipants[\s\S]*?return null;/);
    expect(api).toContain("...(repeatOf ? { repeatInvited } : {})");
  });

  it("writes the invitation in both languages", () => {
    expect(renderNotification("event_repeated", { title: "Кофе" }, "u")).toEqual({
      text: "Организатор снова собирает встречу «Кофе». Отметьте удобное время и место.",
      buttonText: "Выбрать время",
      url: "u",
    });
    expect(renderNotification("event_repeated", { title: "Coffee" }, "u", "en").text)
      .toBe("The organizer is gathering “Coffee” again. Mark the time and place that suit you.");
  });

  it("invites only people who can be written to, respects blocks, bans and the limit, once per meeting", () => {
    expect(migration).toContain("'report_new', 'event_repeated'");
    expect(migration).toContain("'report', 'event_repeat'");
    expect(migration).toContain("values ('event_repeat', 3, 5)");
    expect(migration).toContain("not public.users_blocked_between(p_actor_user_id, participant.user_id)");
    expect(migration).toContain("person.can_message is distinct from false");
    expect(migration).toContain("organizer.banned_at is not null");
    expect(migration).toContain("meeting.repeat_of_event_id is null");
    expect(migration).toContain("source.owner_user_id = p_actor_user_id");
    expect(migration).toContain("limit 50");
    expect(migration).toContain("perform public.consume_action_rate_limit(p_actor_user_id, 'event_repeat');");
    expect(migration).toContain(
      "revoke all on function public.invite_previous_participants(uuid, text, text) from public, anon, authenticated;",
    );
    expect(migration).toContain("grant execute on function public.invite_previous_participants(uuid, text, text) to service_role;");
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    // Only constraint swaps inside alter table (they pass the connector).
    expect(migration.match(/\bdrop\b/gi)).toHaveLength(2);
  });
});
