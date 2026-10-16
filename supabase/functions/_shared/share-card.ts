import { type Language, tr } from "./i18n.ts";
import { formatFinalDetails, quotedTitle } from "./notification-messages.ts";

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
 * sends to any chat through WebApp.shareMessage, in the sender's language.
 */
export function buildShareCard(
  kind: ShareCardKind,
  event: ShareCardEvent,
  url: string,
  resultId: string,
  language: Language = "ru",
) {
  const t = (ru: string, en: string) => tr(language, ru, en);
  const title = quotedTitle(shorten(event.title, 120), language);
  let messageText: string;
  let buttonText: string;
  if (kind === "result") {
    const details = formatFinalDetails(event.startsAt, event.place, event.area, language);
    messageText = details
      ? t(`Итог встречи ${title}: ${details}.`, `The meeting ${title} is set: ${details}.`)
      : t(`Итог встречи ${title} выбран.`, `The meeting ${title} is set.`);
    buttonText = t("Подробнее", "Details");
  } else {
    const description = shorten(event.description, 300);
    messageText = `${t("Соберёмся?", "Shall we meet?")} ${title}\n${description ? `${description}\n` : ""}` +
      t("Отметьте удобное время и место.", "Mark the time and place that suit you.");
    buttonText = t("Проголосовать", "Vote");
  }
  return {
    type: "article",
    id: resultId,
    title: kind === "result" ? t(`Итог встречи ${title}`, `Result of ${title}`) : t(`Встреча ${title}`, `Meeting ${title}`),
    description: kind === "result"
      ? t("Карточка с итогом встречи", "A card with the meeting result")
      : t("Карточка с кнопкой для голосования", "A card with a voting button"),
    input_message_content: { message_text: messageText, link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
  };
}
