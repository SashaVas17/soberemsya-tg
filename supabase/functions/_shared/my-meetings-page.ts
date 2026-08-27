const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 20;
const eventIdPattern = /^[A-Za-z0-9_-]{3,80}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type MyMeetingsRole = "owner" | "participant";

export type MyMeetingsCursor = {
  createdAt: string;
  id: string;
};

function invalidCursor(): never {
  throw Object.assign(new Error("Некорректный курсор списка."), { status: 400 });
}

function base64UrlEncode(value: string) {
  const binary = String.fromCharCode(...new TextEncoder().encode(value));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor();
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    invalidCursor();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    invalidCursor();
  }
}

function validCursor(cursor: unknown): cursor is MyMeetingsCursor {
  if (!cursor || typeof cursor !== "object") return false;
  const value = cursor as Record<string, unknown>;
  return (
    Object.keys(value).length === 2 &&
    typeof value.createdAt === "string" &&
    typeof value.id === "string" &&
    timestampPattern.test(value.createdAt) &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    eventIdPattern.test(value.id)
  );
}

export function parseMyMeetingsRole(value: string | null): MyMeetingsRole {
  if (value === "owner" || value === "participant") return value;
  throw Object.assign(new Error("Некорректный тип встреч."), { status: 400 });
}

export function parseMyMeetingsLimit(value: string | null) {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value))
    throw Object.assign(new Error("Некорректный размер страницы."), { status: 400 });
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw Object.assign(new Error("Некорректный размер страницы."), { status: 400 });
  return Math.min(limit, MAX_LIMIT);
}

export function encodeMyMeetingsCursor(cursor: MyMeetingsCursor) {
  if (!validCursor(cursor)) invalidCursor();
  return base64UrlEncode(JSON.stringify(cursor));
}

export function parseMyMeetingsCursor(value: string | null): MyMeetingsCursor | null {
  if (value === null) return null;
  try {
    const cursor = JSON.parse(base64UrlDecode(value));
    if (!validCursor(cursor)) invalidCursor();
    return cursor;
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    invalidCursor();
  }
}
