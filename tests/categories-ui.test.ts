import { readdirSync, readFileSync } from "node:fs";
import { Coffee, Dices, Tag } from "lucide-react";
import { describe, expect, it } from "vitest";
import { categoryIcon } from "../src/categories";
import { createEventPayload, type CreateWizardDraft } from "../src/create-wizard";
import { mockApi } from "../src/mock-api";
import { hasPublicFeedFilters, normalizeFeedSearch } from "../src/public-feed";
import { readAppSource } from "./app-source";

const appSource = readAppSource();
const feedSource = appSource.slice(
  appSource.indexOf("function PublicMeetings"),
  appSource.indexOf("function MeetingGroup"),
);
const migrationName = readdirSync("supabase/migrations").find((file) => file.endsWith("_meeting_categories.sql"));
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8");

function draft(overrides: Partial<CreateWizardDraft> = {}): CreateWizardDraft {
  return {
    title: "Настолки",
    description: "",
    budgetLimit: 0,
    visibility: "public",
    maxParticipants: null,
    timeOptions: ["2026-11-01T10:00:00.000Z"],
    places: [],
    ...overrides,
  };
}

describe("category icons", () => {
  it("has an icon for every seeded category and a generic one for new ones", () => {
    const seeded = [...migration.matchAll(/\('([a-z-]+)', '[^']+', \d+\)/g)].map((match) => match[1]);
    expect(seeded).toHaveLength(9);
    for (const id of seeded) expect(categoryIcon(id)).not.toBe(Tag);
    expect(categoryIcon("coffee")).toBe(Coffee);
    expect(categoryIcon("boardgames")).toBe(Dices);
    expect(categoryIcon("karaoke")).toBe(Tag);
  });
});

describe("create wizard category", () => {
  it("sends the category only when one is chosen", () => {
    expect(createEventPayload(draft({ category: "boardgames" }))).toMatchObject({ category: "boardgames" });
    expect(createEventPayload(draft({ category: null }))).not.toHaveProperty("category");
    expect(createEventPayload(draft())).not.toHaveProperty("category");
  });

  it("offers optional category chips loaded from the API", () => {
    expect(appSource).toContain("api.categories().then(");
    expect(appSource).toContain('<fieldset className="category-picker">');
    expect(appSource).toContain("<legend>Категория <span>необязательно</span></legend>");
    expect(appSource).toContain("onToggle={() => setCategory(category === choice.id ? null : choice.id)}");
    expect(appSource).toMatch(/\[budgetLimit, category, description,/);
  });
});

describe("open meetings filters", () => {
  it("normalizes the search like the server", () => {
    expect(normalizeFeedSearch("  кофе \n и   десерты ")).toBe("кофе и десерты");
    expect(normalizeFeedSearch(" * ")).toBe("");
    expect(hasPublicFeedFilters({})).toBe(false);
    expect(hasPublicFeedFilters({ q: "   " })).toBe(false);
    expect(hasPublicFeedFilters({ q: "кофе" })).toBe(true);
    expect(hasPublicFeedFilters({ category: "bar" })).toBe(true);
  });

  it("reloads the first page when the category or the settled search changes", () => {
    expect(feedSource).toContain("api.publicMeetings(cursor, { category: categoryId, q: search })");
    expect(feedSource).toContain("}, [categoryId, search]);");
    expect(feedSource).toContain("setNextCursor(null);");
    expect(feedSource).toContain("window.setTimeout(() => setSearch(normalizeFeedSearch(searchInput)), 350)");
  });

  it("has an accessible search field and category toggles", () => {
    expect(feedSource).toContain('aria-label="Поиск по названию"');
    expect(feedSource).toContain('type="search"');
    expect(feedSource).toContain("maxLength={FEED_SEARCH_MAX_LENGTH}");
    expect(feedSource).toContain('aria-label="Очистить поиск"');
    expect(feedSource).toContain('<div aria-label="Категории" className="category-chips" role="group">');
    expect(feedSource).toContain("aria-pressed={categoryId === null}");
    expect(feedSource).toContain("onToggle={() => setCategoryId(categoryId === choice.id ? null : choice.id)}");
    expect(feedSource).toContain("aria-busy={loading}");
    expect(appSource).toContain("function CategoryChip({");
  });

  it("never shows the previous filter's items after a failed reload", () => {
    expect(feedSource).toContain("if (!isLoadingMore) setItems([]);");
  });

  it("drops a chosen category that is no longer offered", () => {
    expect(feedSource).toContain(
      "if (categoryId && !result.categories.some((choice) => choice.id === categoryId))",
    );
  });

  it("explains an empty filtered result and offers a reset", () => {
    expect(feedSource).toContain('title="Ничего не нашлось"');
    expect(feedSource).toContain("Сбросить фильтры");
    expect(feedSource).toContain("<CategoryBadge category={item.category} />");
    expect(appSource).toContain("{preview.category && <CategoryBadge category={preview.category} />}");
  });
});

describe("mock feed filters", () => {
  it("filters the demo meeting by category and title", async () => {
    const all = await mockApi.publicMeetings();
    expect(all.items).toHaveLength(1);
    expect(all.categories).toHaveLength(10);
    expect(all.items[0].category).toEqual({ id: "bar", name: "Бар" });
    expect((await mockApi.publicMeetings(undefined, { category: "bar" })).items).toHaveLength(1);
    expect((await mockApi.publicMeetings(undefined, { category: "cinema" })).items).toHaveLength(0);
    expect((await mockApi.publicMeetings(undefined, { q: "  УЖИН " })).items).toHaveLength(1);
    expect((await mockApi.publicMeetings(undefined, { q: "теннис" })).items).toHaveLength(0);
    expect((await mockApi.categories()).categories.map((category) => category.id)).toContain("outdoor");
  });
});

describe("category on the meeting screens", () => {
  it("resolves the category in the payload and shows it to participants and the organizer", () => {
    const backend = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
    expect(backend).toContain("category: categoryById(categories, event.category_id),");
    expect(appSource.match(/\{event\.category && <CategoryBadge category=\{event\.category\} \/>\}/g)).toHaveLength(2);
  });
});

describe("changing the category in «Управление»", () => {
  it("sends a separate set_category action that notifies nobody", async () => {
    const { managePayloads } = await import("../src/manage-actions");
    expect(managePayloads.setCategory("bar")).toEqual({ action: "set_category", category: "bar" });
    expect(managePayloads.setCategory(null)).toEqual({ action: "set_category", category: null });
    const backend = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
    const action = backend.slice(backend.indexOf('case "set_category": {'), backend.indexOf('case "add_time": {'));
    expect(action).toContain("const categoryId = parseCategoryId(payload.category);");
    expect(action).toContain("if (categoryId && !categoryById(await loadCategories(), categoryId))");
    expect(action).toContain("await updateActiveOwnedEvent(eventId, auth.user.id, { category_id: categoryId });");
  });

  it("offers instant category chips on the manage screen", () => {
    expect(appSource).toContain('onToggle={() => void mutate(managePayloads.setCategory(selected ? null : choice.id), "category")}');
    // The error of an instant change shows next to the chips, not at the bottom of the page.
    expect(appSource).toContain("<ErrorNote message={categoryError} />");
    expect(appSource).toContain("<legend>Категория <span>меняется сразу</span></legend>");
  });

  it("changes and clears the category in the mock", async () => {
    await mockApi.manage("evt_demo", { action: "set_category", category: "cinema" });
    expect((await mockApi.event("evt_demo")).event.category).toEqual({ id: "cinema", name: "Кино" });
    await mockApi.manage("evt_demo", { action: "set_category", category: null });
    expect((await mockApi.event("evt_demo")).event.category).toBeNull();
    await mockApi.manage("evt_demo", { action: "set_category", category: "bar" });
  });
});
