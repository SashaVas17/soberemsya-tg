import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  categoriesFromRows,
  categoryById,
  FEED_SEARCH_MAX_LENGTH,
  parseCategoryId,
  parseFeedSearch,
  titleSearchPattern,
  type CategoryRow,
} from "../supabase/functions/_shared/categories";
import {
  eventCreationHttpError,
  eventCreationRequestHash,
} from "../supabase/functions/_shared/event-creation";

const rows: CategoryRow[] = [
  { id: "bar", name: "Бар", sort_order: 20, is_active: true },
  { id: "coffee", name: "Кофе", sort_order: 10, is_active: true },
  { id: "karaoke", name: "Караоке", sort_order: 15, is_active: false },
];
const categories = categoriesFromRows(rows);

function status(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return null;
}

describe("meeting categories", () => {
  it("lists active categories in display order", () => {
    expect(categories).toEqual([
      { id: "coffee", name: "Кофе" },
      { id: "bar", name: "Бар" },
    ]);
    expect(categoryById(categories, "bar")).toEqual({ id: "bar", name: "Бар" });
    expect(categoryById(categories, "karaoke")).toBeNull();
    expect(categoryById(categories, null)).toBeNull();
  });

  it("treats a missing category as none and rejects malformed ones", () => {
    expect(parseCategoryId(undefined)).toBeNull();
    expect(parseCategoryId(null)).toBeNull();
    expect(parseCategoryId("")).toBeNull();
    expect(parseCategoryId("coffee")).toBe("coffee");
    for (const value of ["Coffee", "c", "coffee,bar", "кофе", 7, {}, "x".repeat(40)])
      expect(status(() => parseCategoryId(value))).toBe(400);
  });

  it("maps an inactive category from the RPC to 400", () => {
    expect(eventCreationHttpError({ code: "P0001", message: "CREATE_EVENT_CATEGORY_INVALID" })).toMatchObject({
      message: "Эта категория недоступна.",
      status: 400,
    });
  });
});

describe("open meetings search", () => {
  it("normalizes the search text and ignores an empty one", () => {
    expect(parseFeedSearch(null)).toBeNull();
    expect(parseFeedSearch("   ")).toBeNull();
    expect(parseFeedSearch("  настолки   в  центре ")).toBe("настолки в центре");
    // PostgREST reads "*" as a wildcard and cannot escape it.
    expect(parseFeedSearch("*")).toBeNull();
    expect(parseFeedSearch("a*b **")).toBe("a b");
    expect(parseFeedSearch("ё".repeat(FEED_SEARCH_MAX_LENGTH))).toHaveLength(FEED_SEARCH_MAX_LENGTH);
    expect(status(() => parseFeedSearch("a".repeat(FEED_SEARCH_MAX_LENGTH + 1)))).toBe(400);
  });

  it("matches LIKE wildcards literally", () => {
    expect(titleSearchPattern("кофе")).toBe("%кофе%");
    expect(titleSearchPattern("100%_скидка\\")).toBe("%100\\%\\_скидка\\\\%");
  });
});

describe("creation request hash", () => {
  const base = {
    title: "Кофе",
    description: "",
    budgetLimit: 0,
    visibility: "public",
    maxParticipants: null,
    startsAt: ["2026-11-01T10:00:00Z"],
    places: [],
  };

  it("keeps hashes of requests without a category unchanged", async () => {
    const legacy = await eventCreationRequestHash(base);
    expect(await eventCreationRequestHash({ ...base, categoryId: null })).toBe(legacy);
    expect(await eventCreationRequestHash({ ...base, categoryId: undefined })).toBe(legacy);
  });

  it("covers the category, so a changed category is a different request", async () => {
    const coffee = await eventCreationRequestHash({ ...base, categoryId: "coffee" });
    expect(coffee).not.toBe(await eventCreationRequestHash(base));
    expect(coffee).not.toBe(await eventCreationRequestHash({ ...base, categoryId: "bar" }));
  });
});

describe("categories migration", () => {
  const name = readdirSync("supabase/migrations").find((file) => file.endsWith("_meeting_categories.sql"));
  const sql = readFileSync(`supabase/migrations/${name}`, "utf8");

  it("locks the table from browser roles and lets the service role read it", () => {
    expect(sql).toContain("alter table public.meeting_categories enable row level security;");
    expect(sql).toContain("revoke all privileges on table public.meeting_categories from public, anon, authenticated;");
    expect(sql).toContain("grant select on table public.meeting_categories to service_role;");
  });

  it("seeds the agreed list", () => {
    for (const [id, title] of [
      ["coffee", "Кофе"], ["bar", "Бар"], ["sport", "Спорт"], ["boardgames", "Настолки"],
      ["walk", "Прогулка"], ["cinema", "Кино"], ["concert", "Концерт"],
      ["outdoor", "Активный отдых"], ["other", "Другое"],
    ])
      expect(sql).toContain(`('${id}', '${title}',`);
  });

  it("keeps the old creation RPCs and wraps them in the same transaction", () => {
    expect(sql).not.toMatch(/create or replace function public\.create_event_(atomic|idempotent)\(/);
    expect(sql).toContain("perform 1 from public.create_event_atomic(");
    expect(sql).toContain("from public.create_event_idempotent(p_client_request_id");
    expect(sql).toContain("if not v_replayed and p_category_id is not null then");
    // A replay is answered before the category check, so a later deactivation
    // cannot turn a retry into a 400 (and the client into a duplicate).
    const idempotent = sql.slice(sql.indexOf("create or replace function public.create_event_idempotent_categorized("));
    expect(idempotent.indexOf("from public.create_event_idempotent(p_client_request_id")).toBeLessThan(
      idempotent.indexOf("message = 'CREATE_EVENT_CATEGORY_INVALID'"),
    );
    expect(sql).toContain("message = 'CREATE_EVENT_CATEGORY_INVALID'");
    expect(sql).toMatch(/grant execute on function public\.create_event_categorized\([^)]*\) to service_role;/);
    expect(sql).toMatch(/grant execute on function public\.create_event_idempotent_categorized\([^)]*\) to service_role;/);
  });

  it("indexes the feed by city and category", () => {
    expect(sql).toContain("on public.events (city_id, category_id, created_at desc, id desc)");
  });
});

describe("categories in the API", () => {
  const backend = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");

  it("checks the category format, leaves activity to the RPC and hashes it", () => {
    expect(backend).toContain("const categoryId = parseCategoryId(payload.category);");
    expect(backend).not.toContain("requireActiveCategory");
    expect(backend).toContain("p_category_id: categoryId,");
    expect(backend).toMatch(/places,\n\s+categoryId,\n\s+\}\),/);
  });

  it("filters the feed by category and title and lists the categories", () => {
    expect(backend).toContain('const requestedCategoryId = parseCategoryId(url.searchParams.get("category"));');
    expect(backend).toContain('const search = parseFeedSearch(url.searchParams.get("q"));');
    expect(backend).toContain("p_category_id: category?.id ?? null,");
    expect(backend).toContain(
      "if (requestedCategoryId && !category) return json({ items: [], nextCursor: null, ...cityFields });",
    );
    expect(backend).toContain("p_title_pattern: search ? titleSearchPattern(search) : null,");
    expect(backend).toContain("category: categoryById(categories, event.category_id),");
  });
});
