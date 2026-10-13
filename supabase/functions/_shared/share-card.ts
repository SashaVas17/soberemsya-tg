import { formatMeetingTime } from "./notification-messages.ts";

export type ShareCardKind = "invite" | "result";

export type ShareCardEvent = {
  title: string;
  description: string;
  startsAt?: string | null;
  place?: string | null;
  area?: string | null;
};

export function parseShareCardKind(value: unknown): ShareCardKind {
  if (value === undefined || value === "invite") return "invite";
  if (value === "result") return "result";
  throw Object.assign(new Error("Некорректный тип карточки."), { status: 400 });
}

function shorten(value: string, limit: number) {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1).trimEnd()}…` : trimmed;
}

/**
 * InlineQueryResultArticle for savePreparedInlineMessage: the card a user
 * sends to any chat through WebApp.shareMessage.
 */
export function buildShareCard(kind: ShareCardKind, event: ShareCardEvent, url: string, resultId: string) {
  const title = `«${shorten(event.title, 120) || "Встреча"}»`;
  let messageText: string;
  let buttonText: string;
  if (kind === "result") {
    const details = [
      formatMeetingTime(event.startsAt ?? ""),
      [event.place, event.area].filter(Boolean).join(", "),
    ].filter(Boolean).join(" · ");
    messageText = `Итог встречи ${title}${details ? `: ${details}` : ""}.`;
    buttonText = "Подробнее";
  } else {
    const description = shorten(event.description, 300);
    messageText = `Соберёмся? ${title}\n${description ? `${description}\n` : ""}Отметьте удобное время и место.`;
    buttonText = "Проголосовать";
  }
  return {
    type: "article",
    id: resultId,
    title: kind === "result" ? `Итог встречи ${title}` : `Встреча ${title}`,
    description: kind === "result" ? "Карточка с итогом встречи" : "Карточка с кнопкой для голосования",
    input_message_content: { message_text: messageText, link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
  };
}
