import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AdminStats, formatStatsText, startParamSource } from "../supabase/functions/_shared/admin-stats";
import { parseStartParam, referralStartParam } from "../supabase/functions/_shared/domain";
import { createMeetingLink, eventDeepLink } from "../supabase/functions/_shared/notification-messages";
import { eventShareUrl, isCreateStartParam, miniAppLink, startParamEventId } from "../src/meeting-links";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_referrals.sql"));
const migration = read(`supabase/migrations/${migrationName}`);
const api = read("supabase/functions/telegram-api/index.ts");
const bot = read("supabase/functions/telegram-bot/index.ts");
const app = read("src/App.tsx");

const code = "0a1b2c3d4e5f";

describe("referral links", () => {
  it("adds the sharer's code to a meeting link and leaves it plain without one", () => {
    expect(miniAppLink("evt_123456789abc", "flocklyappbot", "app", code))
      .toBe(`https://t.me/flocklyappbot/app?startapp=event_evt_123456789abc__r${code}`);
    expect(miniAppLink("evt_123456789abc", "flocklyappbot", "app")).toBe("https://t.me/flocklyappbot/app?startapp=event_evt_123456789abc");
    expect(decodeURIComponent(eventShareUrl("evt_1", "bot", "app", code))).toContain(`startapp=event_evt_1__r${code}`);
    expect(eventDeepLink("bot", "app", "evt_1", code)).toBe(`https://t.me/bot/app?startapp=event_evt_1__r${code}`);
    expect(eventDeepLink("bot", "app", "evt_1")).toBe("https://t.me/bot/app?startapp=event_evt_1");
  });

  it("opens the meeting with or without a code on the client", () => {
    expect(startParamEventId(`event_evt_123456789abc__r${code}`)).toBe("evt_123456789abc");
    expect(startParamEventId("event_evt_123456789abc")).toBe("evt_123456789abc");
    expect(startParamEventId("event_evt_123456789abc__r0a1B")).toBe("evt_123456789abc");
    expect(startParamEventId("event_x")).toBeNull();
    expect(startParamEventId("ntf_evt_1")).toBeNull();
    expect(app).toContain("startParamEventId(result.startParam)");
    expect(app).toContain("setReferralCode(result.referralCode)");
  });

  it("parses the code on the server; a damaged code still opens the meeting", () => {
    expect(parseStartParam(`event_evt_1__r${code}`)).toEqual({ type: "event", eventId: "evt_1", referralCode: code });
    expect(parseStartParam("event_evt_1")).toEqual({ type: "event", eventId: "evt_1" });
    expect(parseStartParam(`event_evt_1__r${code.toUpperCase()}`)).toEqual({ type: "event", eventId: "evt_1" });
    expect(parseStartParam("event_evt_1__r0a1b")).toEqual({ type: "event", eventId: "evt_1" });
    expect(referralStartParam(`event_evt_1__r${code}0`)).toEqual({ eventId: "evt_1", referralCode: undefined });
    // The open itself stays an «event» open: attribution lives in users.
    expect(startParamSource(`event_evt_1__r${code}`)).toBe("event");
  });

  it("attributes at sign-in without failing it and puts the code into prepared cards", () => {
    expect(api).toContain("profile.referralCode ?? await ensureReferralCode(auth.user.id)");
    expect(api).toContain("recordReferral(auth.user.id, start.referralCode)");
    expect(api).toContain('(start?.type === "event" || start?.type === "create") && start.referralCode');
    expect(api).toContain("eventDeepLink(botUsername, appShortName, event.id, await referralCode)");
    expect(api).toMatch(/async function ensureReferralCode[\s\S]*?return null;/);
    expect(api).toContain('db.rpc("admin_referral_stats")');
    expect(bot).toContain('db.rpc("admin_referral_stats")');
  });

  it("keeps attribution first-touch, for new people, and the functions for the service role only", () => {
    expect(migration).toContain("invitee.referred_by_user_id is null");
    expect(migration).toContain("invitee.created_at >= now() - interval '10 minutes'");
    expect(migration).toContain("inviter.created_at < invitee.created_at");
    expect(migration).toContain("p_code !~ '^[0-9a-f]{12}$'");
    for (const fn of ["ensure_referral_code(uuid)", "record_referral(uuid, text)", "admin_referral_stats()"]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(migration).not.toMatch(/\bdrop\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("puts a «plan your own meeting» button under shared cards and opens the new-meeting screen from it", () => {
    expect(createMeetingLink("bot", "app")).toBe("https://t.me/bot/app?startapp=create");
    expect(createMeetingLink("bot", "app", code)).toBe(`https://t.me/bot/app?startapp=create__r${code}`);
    expect(parseStartParam("create")).toEqual({ type: "create" });
    expect(parseStartParam(`create__r${code}`)).toEqual({ type: "create", referralCode: code });
    expect(parseStartParam("create__r0a1b")).toEqual({ type: "create" });
    expect(startParamSource(`create__r${code}`)).toBe("card");
    expect(isCreateStartParam("create")).toBe(true);
    expect(isCreateStartParam(`create__r${code}`)).toBe(true);
    expect(isCreateStartParam("created")).toBe(false);
    expect(api).toContain("createMeetingLink(botUsername, appShortName, await referralCode)");
    expect(app).toContain("isCreateStartParam(result.startParam)");
  });

  it("adds invitations to /stats", () => {
    const stats = {
      referrals: { invited7d: 2, invited30d: 5, topInviters: [{ name: "Анна", username: "anna", invited: 3 }, { name: "Илья", username: null, invited: 2 }] },
    } as unknown as AdminStats;
    const text = formatStatsText({ ...stats, daily: [] } as AdminStats);
    expect(text).toContain("По приглашениям: за 7 дней 2, за 30 дней 5");
    expect(text).toContain("Больше всех пригласили (30 дней): @anna — 3, Илья — 2");
  });
});
