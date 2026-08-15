import type { Status } from "./domain.ts";
import { publicDateSummary, publicParticipantCount } from "./public-preview.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;
const eventIdPattern = /^[A-Za-z0-9_-]{3,80}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type PublicFeedCursor = {
  createdAt: string;
  id: string;
};

export type PublicFeedEvent = {
  id: string;
  ownerUserId: string | null;
  title: string;
  description: string;
  budgetLimit: number;
  maxParticipants: number | null;
  status: Status;
  createdAt: string;
};

export type PublicFeedItem = {
  id: string;
  title: string;
  description: string;
  status: "collecting";
  dateSummary: string | null;
  budgetLimit: number;
  participantCount: number;
  maxParticipants: number | null;
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

function validCursor(cursor: unknown): cursor is PublicFeedCursor {
  if (!cursor || typeof cursor !== "object") return false;
  const value = cursor as Record<string, unknown>;
  if (Object.keys(value).length !== 2) return false;
  if (typeof value.createdAt !== "string" || typeof value.id !== "string")
    return false;
  return (
    timestampPattern.test(value.createdAt) &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    eventIdPattern.test(value.id)
  );
}

export function parsePublicFeedLimit(value: string | null) {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value))
    throw Object.assign(new Error("Некорректный размер страницы."), { status: 400 });
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw Object.assign(new Error("Некорректный размер страницы."), { status: 400 });
  return Math.min(limit, MAX_LIMIT);
}

export function encodePublicFeedCursor(cursor: PublicFeedCursor) {
  if (!validCursor(cursor)) invalidCursor();
  return base64UrlEncode(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }));
}

export function parsePublicFeedCursor(value: string | null): PublicFeedCursor | null {
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

export function publicFeedEligible(input: {
  visibility: string | null;
  deletedAt: string | null;
  status: Status;
}) {
  return (
    input.visibility === "public" &&
    input.deletedAt === null &&
    input.status === "collecting"
  );
}

export function buildPublicFeedItem(input: {
  event: PublicFeedEvent;
  startsAtValues: string[];
  participantUserIds: Array<string | null>;
}): PublicFeedItem {
  return {
    id: input.event.id,
    title: input.event.title,
    description: input.event.description,
    status: "collecting",
    dateSummary: publicDateSummary(input.startsAtValues),
    budgetLimit: input.event.budgetLimit,
    participantCount: publicParticipantCount(
      input.event.ownerUserId,
      input.participantUserIds,
    ),
    maxParticipants: input.event.maxParticipants,
  };
}
