import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blockedUsersResponse,
  moderationHttpError,
  parseModerationTarget,
  parseReportInput,
  parseReportResolution,
  parseReportStatusFilter,
  parseUserId,
  previewHiddenFromViewer,
  REPORT_REASONS as SERVER_REASONS,
  restrictionHttpError,
} from "../supabase/functions/_shared/moderation";
import { errorResponse } from "../supabase/functions/_shared/http";
import { parseStartParam } from "../supabase/functions/_shared/domain";
import { startParamSource } from "../supabase/functions/_shared/admin-stats";
import {
  isNotificationStale,
  notificationLink,
  renderNotification,
} from "../supabase/functions/_shared/notification-messages";
import { REPORT_REASONS as CLIENT_REASONS, moderationTargetBody } from "../src/moderation";
import { SAFE_API_ERROR_CODES } from "../src/api-error";
import { SAFE_APPLICATION_ERROR_CODES } from "../supabase/functions/_shared/errors";
import { mockApi } from "../src/mock-api";
import { readAppSource } from "./app-source";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_moderation.sql"));
const sql = read(`supabase/migrations/${migrationName}`);
const api = read("supabase/functions/telegram-api/index.ts");
const ui = readAppSource();
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
const other = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function thrownStatus(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return null;
}

function functionBody(name: string) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("$$;", start));
}

describe("moderation input", () => {
  it("accepts a known reason, trims the comment and targets the organizer by default", () => {
    expect(parseReportInput({ reason: "spam", comment: "  реклама  " })).toEqual({
      reason: "spam", comment: "реклама", participantId: null, requestId: null,
    });
    expect(parseReportInput({ reason: "fraud", requestId: uuid.toUpperCase() }).requestId).toBe(uuid);
  });

  it("rejects unknown reasons, long comments, bad ids and two targets", () => {
    expect(thrownStatus(() => parseReportInput({ reason: "boring" }))).toBe(400);
    expect(thrownStatus(() => parseReportInput({ reason: "spam", comment: "x".repeat(501) }))).toBe(400);
    expect(thrownStatus(() => parseReportInput({ reason: "spam", comment: 5 }))).toBe(400);
    expect(thrownStatus(() => parseModerationTarget({ participantId: "1; drop" }))).toBe(400);
    expect(thrownStatus(() => parseModerationTarget({ participantId: uuid, requestId: other }))).toBe(400);
    expect(thrownStatus(() => parseUserId("nope"))).toBe(400);
  });

  it("parses admin filters and resolutions", () => {
    expect(parseReportStatusFilter(null)).toBe("open");
    expect(parseReportStatusFilter("dismissed")).toBe("dismissed");
    expect(parseReportStatusFilter("anything")).toBe("open");
    expect(parseReportResolution("resolve")).toBe("resolved");
    expect(parseReportResolution("dismiss")).toBe("dismissed");
    expect(thrownStatus(() => parseReportResolution("delete"))).toBe(400);
  });

  it("keeps the reason lists of the app and the server in sync with the database", () => {
    expect(CLIENT_REASONS).toEqual(SERVER_REASONS);
    expect(sql).toContain(`reason in (${SERVER_REASONS.map((reason) => `'${reason.id}'`).join(", ")})`);
  });

  it("sends only the chosen target to the server", () => {
    expect(moderationTargetBody({ kind: "organizer" })).toEqual({});
    expect(moderationTargetBody({ kind: "participant", participantId: uuid })).toEqual({ participantId: uuid });
    expect(moderationTargetBody({ kind: "requester", requestId: uuid })).toEqual({ requestId: uuid });
  });
});

describe("moderation errors", () => {
  it("maps rate limits to 429 and restrictions to 403 with safe codes", async () => {
    const limited = errorResponse(restrictionHttpError({ code: "P0001", message: "RATE_LIMITED:open_event_create" }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body).toMatchObject({ code: "RATE_LIMITED" });
    expect(body.error).toContain("открытых встреч");
    const restricted = errorResponse(restrictionHttpError({ code: "P0001", message: "USER_RESTRICTED" }));
    expect(restricted.status).toBe(403);
    expect((await restricted.json()).code).toBe("USER_RESTRICTED");
    expect(restrictionHttpError({ code: "P0001", message: "EVENT_UNAVAILABLE" })).toBeNull();
    expect(restrictionHttpError({ code: "23505", message: "RATE_LIMITED:report" })).toBeNull();
    for (const list of [SAFE_API_ERROR_CODES, SAFE_APPLICATION_ERROR_CODES] as readonly (readonly string[])[])
      expect(list).toEqual(expect.arrayContaining(["RATE_LIMITED", "USER_RESTRICTED"]));
  });

  it("maps every moderation token without leaking database text", async () => {
    for (const [token, status] of [
      ["EVENT_UNAVAILABLE", 404],
      ["MODERATION_TARGET_UNAVAILABLE", 404],
      ["MODERATION_TARGET_INVALID", 400],
      ["REPORT_INVALID", 400],
      ["MODERATION_NOT_ALLOWED", 403],
      ["MODERATION_TARGET_SELF", 400],
      ["BLOCK_LIMIT_REACHED", 409],
      ["REPORT_NOT_FOUND", 404],
      ["RATE_LIMITED:report", 429],
    ] as const) {
      const response = errorResponse(moderationHttpError({ code: "P0001", message: token }));
      expect(response.status).toBe(status);
      expect((await response.json()).error).not.toMatch(/P0001|MODERATION|REPORT_|SQL/);
    }
    expect(errorResponse(moderationHttpError({ code: "XX000", message: "boom" })).status).toBe(500);
  });
});

describe("blocks and hidden meetings", () => {
  it("hides a hidden or blocked meeting only from outsiders", () => {
    const base = { hidden: false, blocked: false, isOwner: false, isParticipant: false };
    expect(previewHiddenFromViewer(base)).toBe(false);
    expect(previewHiddenFromViewer({ ...base, hidden: true })).toBe(true);
    expect(previewHiddenFromViewer({ ...base, blocked: true })).toBe(true);
    expect(previewHiddenFromViewer({ ...base, hidden: true, isParticipant: true })).toBe(false);
    expect(previewHiddenFromViewer({ ...base, blocked: true, isOwner: true })).toBe(false);
  });

  it("lists blocked people with a readable name", () => {
    expect(blockedUsersResponse([
      { user_id: "u1", first_name: "Анна", last_name: null, username: "anna", label: "", created_at: "2026-10-14T10:00:00Z" },
      { user_id: "u2", first_name: null, last_name: null, username: null, label: "Организатор встречи «Кино»", created_at: "2026-10-14T11:00:00Z" },
      { user_id: "u3", first_name: null, last_name: null, username: null, label: "", created_at: "2026-10-14T12:00:00Z" },
    ]).users.map((user) => user.name)).toEqual(["Анна", "Организатор встречи «Кино»", "Пользователь Telegram"]);
  });

  it("does not reveal an organizer blocked from the open meeting preview", () => {
    const block = functionBody("block_user");
    expect(block).toContain("v_reveal boolean := p_participant_id is not null or p_request_id is not null;");
    expect(block).toContain("set reveal_identity = b.reveal_identity or excluded.reveal_identity;");
    const list = functionBody("list_user_blocks");
    expect(list).toContain("case when b.reveal_identity then u.username end");
    expect(api).toContain("return json({ blocked: true });");
    expect(api).not.toContain("blocked_user_id ?? null");
  });
});

describe("report notifications", () => {
  it("tells the administrator what was reported and opens the reports screen", () => {
    const url = notificationLink("bot", "app", "report_new", null);
    expect(url).toBe("https://t.me/bot/app?startapp=reports");
    expect(renderNotification("report_new", { targetType: "event", title: "Кальян", reason: "spam" }, url)).toEqual({
      text: "Новая жалоба на встречу «Кальян». Причина: Спам или реклама.",
      buttonText: "Открыть жалобы",
      url,
    });
    expect(renderNotification("report_new", { targetType: "user", title: "Кальян", reason: "fraud", targetName: "Игорь" }, url).text)
      .toBe("Новая жалоба на пользователя Игорь (встреча «Кальян»). Причина: Мошенничество.");
    expect(isNotificationStale("report_new", "cancelled", true)).toBe(false);
  });

  it("accepts the reports start parameter and counts it as a notification open", () => {
    expect(parseStartParam("reports")).toEqual({ type: "home" });
    expect(startParamSource("reports")).toBe("notification");
    expect(ui).toContain('result.startParam === "reports" && result.isAdmin');
  });

  it("allows the new kind in the outbox", () => {
    const constraint = readdirSync("supabase/migrations").filter((name) => name.endsWith("_notification_kind_report_new.sql"));
    expect(constraint).toHaveLength(1);
    expect(read(`supabase/migrations/${constraint[0]}`)).toContain("'report_new'");
  });
});

describe("moderation migration", () => {
  it("stores the agreed limits in a table the owner can edit", () => {
    for (const row of [
      "('event_create', 10, 30)",
      "('open_event_create', 2, 5)",
      "('join_request', 10, 30)",
      "('option_proposal', 20, 50)",
      "('report', 5, 10)",
    ]) expect(sql).toContain(row);
  });

  it("serializes rate limit checks per user and action and counts the last hour and day", () => {
    const body = functionBody("consume_action_rate_limit");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('rate:' || p_user_id::text || ':' || p_action, 0))");
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("count(*)"));
    expect(body).toContain("interval '1 hour'");
    expect(body).toContain("interval '1 day'");
    expect(body).toContain("message = 'RATE_LIMITED:' || p_action");
    expect(sql).toContain("'purge-action-rate-log-daily'");
  });

  it("limits creation after the meeting exists and never counts a replay", () => {
    const plain = functionBody("create_event_categorized");
    expect(plain.indexOf("create_event_atomic")).toBeLessThan(plain.indexOf("'event_create'"));
    expect(plain).toContain("p_visibility = 'public' and exists");
    const idempotent = functionBody("create_event_idempotent_categorized");
    expect(idempotent.indexOf("if not v_replayed then")).toBeLessThan(idempotent.indexOf("consume_action_rate_limit"));
    expect(idempotent).toContain("'open_event_create'");
    expect(idempotent).toContain("'USER_RESTRICTED'");
  });

  it("checks bans, hidden meetings and blocks before a join request and limits only new ones", () => {
    const body = functionBody("create_join_request_moderated");
    expect(body).toContain("'USER_RESTRICTED'");
    expect(body).toContain("public.users_blocked_between(p_requester_user_id, v_event.owner_user_id)");
    // Organizer banned: their meeting takes no requests even if it was reopened.
    expect(body).toContain("u.id = v_event.owner_user_id and u.banned_at is not null");
    // Participants and pending requesters get the idempotent answer first.
    expect(body.indexOf("r.status = 'pending'")).toBeLessThan(body.indexOf("'USER_RESTRICTED'"));
    expect(body).toContain("if v_outcome = 'created_pending' then");
    expect(body.indexOf("public.create_join_request(")).toBeLessThan(body.indexOf("consume_action_rate_limit"));
  });

  it("counts proposals and reports, and does not count a repeated report", () => {
    expect(functionBody("propose_event_time_option_limited")).toContain("'option_proposal'");
    expect(functionBody("propose_event_place_option_limited")).toContain("'option_proposal'");
    const report = functionBody("create_report");
    expect(report.indexOf("if not v_created then")).toBeLessThan(report.indexOf("consume_action_rate_limit"));
    expect(report).toContain("'report_new'");
    expect(report).toContain("admin.telegram_user_id = any(");
    // One open report per target: after it is closed, the person can report again.
    expect(sql).toContain("on public.reports (reporter_user_id, event_id) where target_type = 'event' and status = 'open'");
    expect(sql).toContain("on public.reports (reporter_user_id, target_user_id) where target_type = 'user' and status = 'open'");
    expect(report).toContain("where target_type = 'event' and status = 'open' do nothing");
  });

  it("lets only the organizer target participants and requesters", () => {
    const body = functionBody("moderation_target_user");
    expect(body).toContain("if v_event.owner_user_id is distinct from p_actor_user_id then");
    expect(body).toContain("'MODERATION_TARGET_SELF'");
    expect(body).toContain("v_event.visibility <> 'public' and not exists");
  });

  it("hides open meetings of a banned user and caps blocks per user", () => {
    const ban = functionBody("admin_set_user_banned");
    expect(ban).toContain("e.visibility = 'public'");
    expect(ban).not.toContain("e.status = 'collecting'");
    expect(functionBody("block_user")).toContain("r.requester_user_id = p_actor_user_id and r.event_id in (");
    expect(functionBody("block_user")).toContain(">= 200");
    expect(functionBody("block_user")).toContain("set status = 'rejected'");
  });

  it("closes browser roles out of the new tables and functions", () => {
    for (const table of ["action_rate_limits", "action_rate_log", "user_blocks", "reports"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all privileges on table public.${table} from public, anon, authenticated;`);
    }
    const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((match) => match[1]);
    for (const name of functions.filter((name) => !name.startsWith("create_event_")))
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
  });
});

describe("moderation API", () => {
  it("registers the routes with their methods", () => {
    for (const fragment of [
      'if (path === "/admin/reports") return ["GET"];',
      'if (path === "/me/blocks") return ["GET"];',
      'if (path === "/me/community-rules") return ["POST"];',
      "(report|block)$/.test(path)) return [\"POST\"];",
      "(resolve|dismiss)$/.test(path)) return [\"POST\"];",
      "(hide|unhide)$/.test(path)) return [\"POST\"];",
      "(ban|unban)$/.test(path)) return [\"POST\"];",
    ]) expect(api).toContain(fragment);
  });

  it("checks the administrator before every admin RPC", () => {
    for (const name of ["adminReports", "adminResolveReport", "adminHideEvent", "adminBanUser"]) {
      const start = api.indexOf(`async function ${name}(`);
      const body = api.slice(start, api.indexOf("\n}\n", start));
      expect(body.indexOf("if (!isAdmin(auth)) return adminNotFound();")).toBeGreaterThan(0);
      expect(body.indexOf("if (!isAdmin(auth))")).toBeLessThan(body.indexOf("db.rpc("));
    }
  });

  it("uses the moderated RPCs and maps their restrictions first", () => {
    expect(api).toContain('db.rpc("create_join_request_moderated"');
    expect(api).toContain('db.rpc("propose_event_time_option_limited"');
    expect(api).toContain('db.rpc("propose_event_place_option_limited"');
    expect(api).toContain("throw restrictionHttpError(error) ?? eventCreationHttpError(error);");
    expect(api).toContain("throw restrictionHttpError(error) ?? createJoinRequestHttpError(error);");
    expect(api).toContain("p_admin_telegram_ids: [...adminIds].map(Number)");
  });

  it("keeps hidden meetings and blocked organizers out of the feed and preview", () => {
    const feed = functionBody("public_feed_page");
    expect(feed).toContain("e.hidden_at is null");
    expect(feed).toContain("and not exists (");
    expect(feed).toContain("b.blocker_user_id = e.owner_user_id and b.blocked_user_id = p_viewer_user_id");
    expect(api).toContain('db.rpc("public_feed_page"');
    expect(api).toContain("communityRulesAccepted: profile.communityRulesAccepted");
    expect(api).toContain("previewHiddenFromViewer({ hidden: event.hidden_at !== null, blocked, isOwner, isParticipant: participantExists })");
  });
});

describe("moderation screens", () => {
  it("shows the rules before the first look at open meetings", () => {
    expect(ui).toContain("if (result.communityRulesAccepted === false) setRulesPending(true);");
    expect(ui).toContain("<Presence show={rulesPending}>");
    expect(ui).toContain("<CommunityRulesDialog onAccepted={() => setRulesPending(false)} />");
  });

  it("offers report and block on open meetings, requests and participants", () => {
    expect(ui).toContain('<SafetyActions eventId={preview.id} onBlocked={() => navigate("/open")} />');
    expect(ui).toContain('{!event.canManage && event.visibility === "public" && <SafetyActions eventId={eventId} />}');
    expect(ui).toContain('target={{ kind: "participant", participantId: person.id }}');
    expect(read("src/OrganizerJoinRequests.tsx")).toContain('target={{ kind: "requester", requestId: request.requestId }}');
  });

  it("renders dialogs outside glass panels and gives the admin screen only to administrators", () => {
    expect(ui).toContain("return createPortal(");
    expect(ui).toContain('if (path === "/admin/reports" && auth.isAdmin)');
    expect(ui).toContain('if (path === "/blocked")');
    expect(ui).toContain('if (path === "/rules")');
  });

  it("runs the mock moderation flow", async () => {
    expect((await mockApi.publicMeetings()).communityRulesAccepted).toBe(false);
    await mockApi.acceptCommunityRules();
    expect((await mockApi.publicMeetings()).communityRulesAccepted).toBe(true);
    expect(await mockApi.blockFromEvent({ kind: "organizer" })).toEqual({ blocked: true });
    const [blocked] = (await mockApi.blockedUsers()).users;
    await mockApi.unblockUser(blocked.userId);
    expect((await mockApi.blockedUsers()).users).toEqual([]);
    const [report] = (await mockApi.adminReports("open")).reports;
    await mockApi.adminSetEventHidden(report.event!.id, true);
    expect((await mockApi.adminReports("open")).reports).toEqual([]);
    expect((await mockApi.adminReports("resolved")).reports[0].event?.hidden).toBe(true);
  });
});
