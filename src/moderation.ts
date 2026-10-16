import { t } from "./i18n";
// Stage 2.4: reports, blocks and the community rules. The server enforces
// everything; this module holds texts and small helpers for the screens.

export const REPORT_REASONS = [
  { id: "spam", label: "Спам или реклама" },
  { id: "fraud", label: "Мошенничество" },
  { id: "offensive", label: "Оскорбления" },
  { id: "dangerous", label: "Опасная встреча" },
  { id: "fake", label: "Фейк: чужое имя или ненастоящая встреча" },
  { id: "other", label: "Другое" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const REPORT_COMMENT_MAX_LENGTH = 500;

export function reportReasonLabel(reason: string) {
  const label = REPORT_REASONS.find((item) => item.id === reason)?.label;
  return label ? t(label) : t("Другое");
}

/** A person in a meeting: the organizer by default, or one the organizer sees. */
export type ModerationTarget =
  | { kind: "organizer" }
  | { kind: "participant"; participantId: string }
  | { kind: "requester"; requestId: string };

export function moderationTargetBody(target: ModerationTarget) {
  if (target.kind === "participant") return { participantId: target.participantId };
  if (target.kind === "requester") return { requestId: target.requestId };
  return {};
}

export const COMMUNITY_RULES_TITLE = "Правила открытых встреч";

/** Shown before the first visit to open meetings and on the rules screen. */
export const COMMUNITY_RULES = [
  "Открытые встречи видят все пользователи Flockly в вашем городе. Пишите в названии и описании, что вы планируете, без контактов и ссылок на сторонние сервисы.",
  "Встречайтесь в людных местах, сами добирайтесь до места и обратно, не передавайте незнакомым деньги и документы.",
  "Запрещены реклама, продажи, мошенничество, оскорбления, угрозы, дискриминация и встречи, которые нарушают закон.",
  "Если что-то не так — пожалуйтесь на встречу или человека и заблокируйте его: вы перестанете видеть встречи друг друга. Жалобы рассматривает администратор.",
  "За нарушения администратор скрывает встречи и закрывает доступ к открытым встречам. Чтобы не было спама, число встреч, заявок и жалоб в час и в сутки ограничено.",
] as const;

export function personName(name: string | null, username: string | null) {
  const label = name?.trim() || t("Пользователь Telegram");
  return username ? `${label} (@${username})` : label;
}
