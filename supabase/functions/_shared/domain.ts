import { applicationError } from "./errors.ts";

export type Status = "collecting" | "place_selection" | "decided" | "cancelled";

export type ParticipantResponseAction = "insert-private" | "update";

export function assertFullEventReadAccess(input: {
  visibility?: string | null;
  ownerUserId: string | null;
  currentUserId: string;
  participantExists: boolean;
}) {
  if (
    input.visibility !== "public" ||
    input.ownerUserId === input.currentUserId ||
    input.participantExists
  )
    return;

  throw applicationError(
    "PUBLIC_PREVIEW_REQUIRED",
    403,
    "Доступна только публичная информация о встрече.",
  );
}

export function authorizeParticipantResponse(input: {
  visibility?: string | null;
  ownerUserId: string | null;
  currentUserId: string;
  participantId: string | null;
}): ParticipantResponseAction {
  const visibility = input.visibility === "public" ? "public" : "private";
  if (visibility === "private")
    return input.participantId ? "update" : "insert-private";

  if (input.ownerUserId === input.currentUserId)
    throw applicationError(
      "PUBLIC_OWNER_CANNOT_RESPOND",
      403,
      "Организатор не может отвечать как участник открытой встречи.",
    );

  if (!input.participantId)
    throw applicationError(
      "PUBLIC_JOIN_REQUIRED",
      403,
      "Сначала отправьте заявку и дождитесь одобрения организатора.",
    );

  return "update";
}

export function assertVotingOpen(status: Status) {
  if (status !== "collecting") throw Object.assign(new Error("Сбор ответов уже закрыт."), { status: 409 });
}

export function assertOwner(ownerUserId: string | null, currentUserId: string) {
  if (!ownerUserId || ownerUserId !== currentUserId) throw Object.assign(new Error("У вас нет доступа к управлению этой встречей."), { status: 403 });
}

export function participantIdentityKey(eventId: string, userId: string) {
  if (!eventId || !userId) throw new Error("Event and user are required");
  return `${eventId}:${userId}`;
}

export function assertEventAvailable<T extends object>(event: T | null): asserts event is T {
  if (!event || ("deleted_at" in event && event.deleted_at))
    throw Object.assign(new Error("Встреча не найдена или удалена."), {
      code: "EVENT_UNAVAILABLE",
      status: 404,
    });
}

export function parseEventStartParam(startParam: string | null) {
  if (!startParam) return null;
  const match = startParam.match(/^event_([A-Za-z0-9_-]{3,80})$/);
  if (!match) throw Object.assign(new Error("Некорректная ссылка на встречу."), { status: 400 });
  return match[1];
}

/**
 * A shared meeting link carries the sharer's code: event_<id>__r<code>.
 * The format is also in src/meeting-links.ts, notification-messages.ts
 * (eventDeepLink) and the referrals migration. A damaged code still opens
 * the meeting; it is only not counted.
 */
const REFERRAL_EVENT_START = /^event_([A-Za-z0-9_-]{3,80}?)__r([A-Za-z0-9_-]*)$/;
export const REFERRAL_CODE = /^[0-9a-f]{12}$/;

export function referralStartParam(startParam: string | null) {
  const match = startParam?.match(REFERRAL_EVENT_START);
  if (!match) return null;
  return { eventId: match[1], referralCode: REFERRAL_CODE.test(match[2]) ? match[2] : undefined };
}

export type StartParam =
  | { type: "event"; eventId: string; referralCode?: string }
  | { type: "group"; token: string }
  | { type: "home" };

/**
 * Accepts event_<id>, event_<id>__r<code> (a link shared by a person),
 * group_<token> (issued by /new in a group chat) and ntf / ntf_<id>
 * (notification buttons).
 */
export function parseStartParam(startParam: string | null): StartParam | null {
  if (!startParam) return null;
  if (startParam === "ntf") return { type: "home" };
  // Report notifications for the administrator open the reports screen.
  if (startParam === "reports") return { type: "home" };
  const notification = startParam.match(/^ntf_([A-Za-z0-9_-]{3,80})$/);
  if (notification) return { type: "event", eventId: notification[1] };
  const group = startParam.match(/^group_([A-Za-z0-9_-]{24})$/);
  if (group) return { type: "group", token: group[1] };
  const referral = referralStartParam(startParam);
  if (referral)
    return referral.referralCode
      ? { type: "event", eventId: referral.eventId, referralCode: referral.referralCode }
      : { type: "event", eventId: referral.eventId };
  const eventId = parseEventStartParam(startParam);
  return eventId ? { type: "event", eventId } : null;
}
