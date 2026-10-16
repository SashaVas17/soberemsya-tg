import { applicationError } from "./errors.ts";
import { type Language, tr } from "./i18n.ts";

// Stage 2.4: reports, blocks, administrator tools and rate limits. The
// database enforces all of it (see the moderation migration); this module
// parses requests and maps RPC error tokens to HTTP answers.

export const REPORT_REASONS = [
  { id: "spam", label: "Спам или реклама" },
  { id: "fraud", label: "Мошенничество" },
  { id: "offensive", label: "Оскорбления" },
  { id: "dangerous", label: "Опасная встреча" },
  { id: "fake", label: "Фейк: чужое имя или ненастоящая встреча" },
  { id: "other", label: "Другое" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

const reportReasonIds = new Set<string>(REPORT_REASONS.map((reason) => reason.id));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const REPORT_COMMENT_MAX_LENGTH = 500;

const REPORT_REASON_LABELS_EN: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  fraud: "Fraud",
  offensive: "Insults",
  dangerous: "Dangerous meeting",
  fake: "Fake: someone else's name or a fake meeting",
  other: "Other",
};

export function reportReasonLabel(reason: unknown, language: Language = "ru") {
  const item = REPORT_REASONS.find((entry) => entry.id === reason) ?? REPORT_REASONS.at(-1)!;
  return tr(language, item.label, REPORT_REASON_LABELS_EN[item.id]);
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function optionalUuid(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!uuidPattern.test(normalized)) invalid("Некорректный участник.");
  return normalized;
}

export function parseUserId(value: string) {
  const id = optionalUuid(value);
  if (!id) invalid("Некорректный пользователь.");
  return id;
}

export function parseReportId(value: string) {
  const id = optionalUuid(value);
  if (!id) invalid("Некорректная жалоба.");
  return id;
}

/**
 * Whom a report or block is about: the organizer of the meeting by default,
 * or one of its participants or join requesters (organizer only).
 */
export function parseModerationTarget(body: Record<string, unknown>) {
  const participantId = optionalUuid(body.participantId);
  const requestId = optionalUuid(body.requestId);
  if (participantId && requestId) invalid("Укажите одного человека.");
  return { participantId, requestId };
}

export function parseReportInput(body: Record<string, unknown>) {
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!reportReasonIds.has(reason)) invalid("Выберите причину жалобы.");
  const rawComment = body.comment ?? "";
  if (typeof rawComment !== "string") invalid("Некорректный комментарий.");
  const comment = rawComment.trim();
  if (comment.length > REPORT_COMMENT_MAX_LENGTH)
    invalid(`Комментарий — не длиннее ${REPORT_COMMENT_MAX_LENGTH} символов.`);
  return { reason: reason as ReportReason, comment, ...parseModerationTarget(body) };
}

export type ReportStatusFilter = "open" | "resolved" | "dismissed";

export function parseReportStatusFilter(value: string | null): ReportStatusFilter {
  return value === "resolved" || value === "dismissed" ? value : "open";
}

export function parseReportResolution(value: string) {
  if (value === "resolve") return "resolved" as const;
  if (value === "dismiss") return "dismissed" as const;
  invalid("Некорректное действие.");
}

const rateLimitMessages: Record<string, string> = {
  event_create: "Вы создали много встреч за короткое время. Попробуйте позже.",
  open_event_create: "Вы создали много открытых встреч за короткое время. Попробуйте позже.",
  join_request: "Вы отправили много заявок за короткое время. Попробуйте позже.",
  option_proposal: "Вы предложили много вариантов за короткое время. Попробуйте позже.",
  report: "Вы отправили много жалоб за короткое время. Попробуйте позже.",
};

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return record.message;
}

/**
 * Rate limits and administrator restrictions, which any moderated action can
 * raise. Returns null for other errors, so callers fall back to their own
 * mapping: `throw restrictionHttpError(error) ?? ownHttpError(error)`.
 */
export function restrictionHttpError(error: unknown) {
  const message = errorMessage(error);
  if (!message) return null;
  const rateLimited = message.match(/^RATE_LIMITED:([a-z_]+)$/);
  if (rateLimited)
    return applicationError(
      "RATE_LIMITED",
      429,
      rateLimitMessages[rateLimited[1]] ?? "Слишком много действий за короткое время. Попробуйте позже.",
    );
  if (message === "USER_RESTRICTED")
    return applicationError(
      "USER_RESTRICTED",
      403,
      "Администратор ограничил вам создание открытых встреч и заявки на участие.",
    );
  return null;
}

/** Errors of reports, blocks and administrator actions. */
export function moderationHttpError(error: unknown) {
  const restriction = restrictionHttpError(error);
  if (restriction) return restriction;
  switch (errorMessage(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 });
    case "MODERATION_TARGET_UNAVAILABLE":
      return Object.assign(new Error("Пользователь не найден."), { status: 404 });
    case "MODERATION_TARGET_INVALID":
    case "REPORT_INVALID":
      return Object.assign(new Error("Проверьте данные и попробуйте ещё раз."), { status: 400 });
    case "MODERATION_NOT_ALLOWED":
      return Object.assign(new Error("Это действие недоступно."), { status: 403 });
    case "MODERATION_TARGET_SELF":
      return Object.assign(new Error("Это действие нельзя применить к себе."), { status: 400 });
    case "BLOCK_LIMIT_REACHED":
      return Object.assign(
        new Error("Заблокировано слишком много людей. Разблокируйте кого-нибудь: внизу ленты «Открытые» — «Заблокированные»."),
        { status: 409 },
      );
    case "REPORT_NOT_FOUND":
      return Object.assign(new Error("Жалоба не найдена."), { status: 404 });
    default:
      return new Error("Не удалось выполнить действие.");
  }
}

export type BlockedUserRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  label: string | null;
  created_at: string;
};

export function displayName(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].map((part) => part?.trim()).filter(Boolean).join(" ") || "Пользователь Telegram";
}

export function blockedUsersResponse(rows: BlockedUserRow[]) {
  return {
    users: rows.map((row) => ({
      userId: row.user_id,
      // Without a revealed identity the database sends only a label.
      name: row.first_name || row.last_name
        ? displayName(row.first_name, row.last_name)
        : row.label?.trim() || "Пользователь Telegram",
      username: row.username,
      blockedAt: row.created_at,
    })),
  };
}

/** Only an organizer or a participant may see a hidden meeting or one across a block. */
export function previewHiddenFromViewer(input: {
  hidden: boolean;
  blocked: boolean;
  isOwner: boolean;
  isParticipant: boolean;
}) {
  if (input.isOwner || input.isParticipant) return false;
  return input.hidden || input.blocked;
}
