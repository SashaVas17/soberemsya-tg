import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPublicFeedItem, encodePublicFeedCursor, parsePublicFeedCursor, parsePublicFeedLimit, publicFeedEligible } from "../supabase/functions/_shared/public-feed";
import { readdirSync as listMigrations, readFileSync as readMigration } from "node:fs";

const feedSql = (() => {
  const name = listMigrations("supabase/migrations").find((file) => file.endsWith("_moderation.sql"));
  const sql = readMigration(`supabase/migrations/${name}`, "utf8");
  const start = sql.indexOf("create or replace function public.public_feed_page(");
  return sql.slice(start, sql.indexOf("$$;", start));
})();

const backendSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);

function event(overrides: Partial<{
  id: string;
  ownerUserId: string | null;
  title: string;
  description: string;
  budgetLimit: number;
  maxParticipants: number | null;
  status: "collecting";
  createdAt: string;
}> = {}) {
  return {
    id: "evt_public_1",
    ownerUserId: "owner_1",
    title: "Открытая встреча",
    description: "Описание",
    budgetLimit: 40,
    maxParticipants: 6,
    status: "collecting" as const,
    createdAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("public meetings feed eligibility", () => {
  it("accepts only public, collecting, non-deleted events", () => {
    expect(publicFeedEligible({ visibility: "public", deletedAt: null, status: "collecting" })).toBe(true);
  });

  it.each([
    ["private", null, "collecting"],
    ["public", "2026-08-15T12:00:00.000Z", "collecting"],
    ["public", null, "place_selection"],
    ["public", null, "decided"],
    ["public", null, "cancelled"],
  ] as const)("excludes %s/%s/%s", (visibility, deletedAt, status) => {
    expect(publicFeedEligible({ visibility, deletedAt, status })).toBe(false);
  });
});

describe("public meetings feed shape", () => {
  it("contains only safe public fields", () => {
    const item = buildPublicFeedItem({
      event: event(),
      startsAtValues: ["2026-08-15T16:30:00.000Z"],
      participantUserIds: ["owner_1", "participant_1"],
    });
    expect(Object.keys(item)).toEqual([
      "id",
      "title",
      "description",
      "status",
      "dateSummary",
      "budgetLimit",
      "participantCount",
      "maxParticipants",
      "category",
    ]);
    for (const field of [
      "ownerUserId",
      "adminToken",
      "participants",
      "userId",
      "name",
      "preferences",
      "restrictions",
      "votes",
      "joinRequestStatus",
      "createdAt",
    ])
      expect(item).not.toHaveProperty(field);
  });

  it("preserves public-preview owner participant counting", () => {
    const item = buildPublicFeedItem({
      event: event(),
      startsAtValues: [],
      participantUserIds: ["owner_1", "participant_1", null],
    });
    expect(item.participantCount).toBe(3);
  });
});

describe("public meetings feed pagination", () => {
  it("uses a default limit of 20 and caps larger values at 20", () => {
    expect(parsePublicFeedLimit(null)).toBe(20);
    expect(parsePublicFeedLimit("20")).toBe(20);
    expect(parsePublicFeedLimit("200")).toBe(20);
  });

  it.each(["", "0", "-1", "1.5", "twenty"])("rejects malformed limit %j", (limit) => {
    expect(() => parsePublicFeedLimit(limit)).toThrow("Некорректный размер страницы.");
  });

  it("round-trips an opaque composite cursor", () => {
    const cursor = {
      createdAt: "2026-08-15T12:00:00.123456+00:00",
      id: "evt_public_1",
    };
    const encoded = encodePublicFeedCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain(cursor.createdAt);
    expect(parsePublicFeedCursor(encoded)).toEqual(cursor);
  });

  it.each([
    "not base64!",
    "eyJjcmVhdGVkQXQiOiJiYWQiLCJpZCI6ImV2dCJ9",
    "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6ImV2dCIsImV4dHJhIjp0cnVlfQ",
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => parsePublicFeedCursor(cursor)).toThrow("Некорректный курсор списка.");
  });

  it("uses created_at and id as the deterministic keyset boundary", () => {
    const source = backendSource.slice(
      backendSource.indexOf("async function publicEvents"),
      backendSource.indexOf("async function calendarLink"),
    );
    // The page query lives in SQL (public_feed_page, stage 2.4 moderation).
    expect(source).toContain('db.rpc("public_feed_page"');
    expect(source).toContain("p_cursor_created_at: cursor?.createdAt ?? null,");
    expect(source).toContain("p_cursor_id: cursor?.id ?? null,");
    expect(source).toContain("p_limit: limit + 1,");
    expect(feedSql).toContain("order by e.created_at desc, e.id desc");
    expect(feedSql).toContain("or (e.created_at = p_cursor_created_at and e.id < p_cursor_id))");
    expect(source).toContain("encodePublicFeedCursor");
    expect(source).toContain(": null,");
  });
});

describe("public meetings feed endpoint boundaries", () => {
  const source = backendSource.slice(
    backendSource.indexOf("async function publicEvents"),
    backendSource.indexOf("async function calendarLink"),
  );

  it("enforces fixed eligibility filters and batched minimal relation reads", () => {
    expect(feedSql).toContain("and e.visibility = 'public'");
    expect(feedSql).toContain("and e.deleted_at is null");
    expect(feedSql).toContain("and e.status = 'collecting'");
    expect(source).toContain('select("event_id,starts_at")');
    expect(source).toContain('select("event_id,user_id")');
    expect(source).not.toContain("eventPayload(");
    expect(source).not.toContain('db.from("place_options")');
    expect(source).not.toContain('db.from("availability_votes")');
    expect(source).not.toContain('db.from("join_requests")');
  });

  it("requires Telegram authentication before route dispatch", () => {
    const handler = backendSource.slice(
      backendSource.indexOf("async function handleApiRequest"),
      backendSource.indexOf("Deno.serve"),
    );
    expect(handler.indexOf("const auth = await authenticate(request);")).toBeLessThan(
      handler.indexOf('path === "/public/events"'),
    );
    expect(backendSource).toContain('path === "/public/events") return ["GET"]');
  });

  it("leaves the existing public preview route and helper in place", () => {
    expect(backendSource).toContain("async function publicEventPreview");
    expect(backendSource).toContain('path.match(/^\\/events\\/([^/]+)\\/preview$/)');
  });
});
