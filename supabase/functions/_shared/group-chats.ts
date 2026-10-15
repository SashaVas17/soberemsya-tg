import { type Language, tr } from "./i18n.ts";
import { formatFinalDetails, type NotificationMessage, quotedTitle } from "./notification-messages.ts";

export type GroupMessageKind = "group_card" | "group_decided";

type Payload = Record<string, unknown>;

const GROUP_TOKEN = /^[A-Za-z0-9_-]{24}$/;

function text(payload: Payload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Optional groupToken of a create request; a malformed one is rejected. */
export function parseGroupToken(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !GROUP_TOKEN.test(value))
    throw Object.assign(new Error("Некорректная ссылка из группы."), { status: 400 });
  return value;
}

export function groupLinkExpiredError() {
  return Object.assign(
    new Error("Ссылка из группы устарела. Напишите /new в группе ещё раз."),
    { status: 410, code: "GROUP_LINK_EXPIRED" },
  );
}

export function groupLinkNotIssuerError() {
  return Object.assign(
    new Error("Эту ссылку создал другой участник чата. Напишите /new в группе, чтобы создать свою встречу."),
    { status: 403, code: "GROUP_LINK_NOT_ISSUER" },
  );
}

export function groupCreateUrl(bot: string, app: string, token: string) {
  return `https://t.me/${bot}/${app}?startapp=group_${token}`;
}

/**
 * Group messages are only the meeting card and the final result, in the
 * organizer's language (the group has none of its own).
 */
export function renderGroupMessage(
  kind: GroupMessageKind,
  payload: Payload,
  url: string,
  language: Language = "ru",
): NotificationMessage {
  const t = (ru: string, en: string) => tr(language, ru, en);
  const title = quotedTitle(text(payload, "title"), language);
  if (kind === "group_card") {
    const organizer = text(payload, "organizer");
    return {
      text: (organizer
        ? t(`${organizer} предлагает встречу ${title}.`, `${organizer} suggests a meeting ${title}.`)
        : t(`Новая встреча ${title}.`, `New meeting ${title}.`)) +
        "\n" + t("Отметьте удобное время и место.", "Mark the time and place that suit you."),
      buttonText: t("Проголосовать", "Vote"),
      url,
    };
  }
  const details = formatFinalDetails(text(payload, "startsAt"), text(payload, "place"), text(payload, "area"), language);
  return {
    text: details
      ? t(`Итог встречи ${title}: ${details}.`, `The meeting ${title} is set: ${details}.`)
      : t(`Итог встречи ${title} выбран.`, `The meeting ${title} is set.`),
    buttonText: t("Подробнее", "Details"),
    url,
  };
}

/** A card is pointless for a cancelled meeting, a result once it was reopened. */
export function isGroupMessageStale(kind: GroupMessageKind, eventStatus: string | null, eventDeleted: boolean) {
  if (eventDeleted || eventStatus === "cancelled") return true;
  return kind === "group_decided" && eventStatus !== "decided";
}

/**
 * Returns the command addressed to this bot ("/new"), or null for plain
 * text and for commands addressed to another bot (/new@other_bot).
 */
export function parseBotCommand(messageText: string, botUsername: string): string | null {
  const first = messageText.trim().split(/\s/)[0] ?? "";
  const match = first.match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?$/);
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return `/${match[1].toLowerCase()}`;
}

export function isGroupChatType(chatType: unknown) {
  return chatType === "group" || chatType === "supergroup";
}

/** Commands the bot answers in a group; others get no reply. */
export const GROUP_REPLY_COMMANDS = new Set(["/new", "/start", "/help", "/my"]);

/** In groups web_app buttons are not allowed, so replies use t.me links. */
export function groupCommandReply(command: string, appUrl: string, createUrl: string | null, language: Language = "ru") {
  const t = (ru: string, en: string) => tr(language, ru, en);
  if (command === "/new" && createUrl)
    return {
      text: t(
        "Создайте встречу для этого чата. Когда она будет готова, здесь появится карточка для голосования, " +
          "а после выбора — итог. Кнопка действует 24 часа и только для отправителя команды.",
        "Create a meeting for this chat. When it is ready, a voting card will appear here, " +
          "and the result after the choice. The button works for 24 hours and only for the sender of the command.",
      ),
      reply_markup: { inline_keyboard: [[{ text: t("Создать встречу", "Create meeting"), url: createUrl }]] },
    };
  if (command === "/new")
    return {
      text: t(
        "Отправьте /new от своего имени, а не анонимно: встреча создаётся от лица участника.",
        "Send /new under your own name, not anonymously: a meeting is created on behalf of a member.",
      ),
    };
  if (command === "/start" || command === "/help" || command === "/my")
    return {
      text: t(
        "Flockly помогает договориться о времени, месте и бюджете встречи. " +
          "Напишите /new, чтобы создать встречу для этого чата.",
        "Flockly helps agree on the time, place and budget of a meeting. " +
          "Send /new to create a meeting for this chat.",
      ),
      reply_markup: { inline_keyboard: [[{ text: t("Открыть Flockly", "Open Flockly"), url: appUrl }]] },
    };
  return null;
}
