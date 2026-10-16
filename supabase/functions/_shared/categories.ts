// Meeting categories (Stage 2.2) and the open meetings feed search.
const categoryIdPattern = /^[a-z][a-z0-9-]{1,31}$/;
export const FEED_SEARCH_MAX_LENGTH = 80;

export type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type Category = { id: string; name: string };

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

/** Active categories in display order. */
export function categoriesFromRows(rows: CategoryRow[]): Category[] {
  return rows
    .filter((row) => row.is_active)
    .sort((left, right) =>
      left.sort_order - right.sort_order || left.name.localeCompare(right.name, "ru"),
    )
    .map((row) => ({ id: row.id, name: row.name }));
}

/** A missing or empty category means "no category". */
export function parseCategoryId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !categoryIdPattern.test(value))
    badRequest("Некорректная категория.");
  return value;
}

export function categoryById(categories: Category[], categoryId: string | null | undefined) {
  return categories.find((category) => category.id === categoryId) ?? null;
}

/**
 * Trimmed search text with collapsed spaces, or null when empty. PostgREST
 * reads "*" in a LIKE pattern as a wildcard and cannot escape it, so it is
 * dropped like a space.
 */
export function parseFeedSearch(value: string | null): string | null {
  if (value === null) return null;
  const text = value.replace(/[\s*]+/g, " ").trim();
  if (!text) return null;
  if ([...text].length > FEED_SEARCH_MAX_LENGTH)
    badRequest(`Поисковый запрос длиннее ${FEED_SEARCH_MAX_LENGTH} символов.`);
  return text;
}

/** ILIKE pattern that matches the text (without "*") literally anywhere in the title. */
export function titleSearchPattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
