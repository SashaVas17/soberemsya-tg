// Language of server texts: bot replies, notifications, group messages,
// share cards and date summaries. The rule matches the app (src/i18n.ts):
// a chosen language wins, otherwise Russian for Telegram languages of the
// CIS and English for the rest.

export type Language = "ru" | "en";

/** Header with the app's current language on every API request. */
export const LANGUAGE_HEADER = "x-flockly-language";

// Telegram languages that read Russian more easily than English.
const russianFirst = new Set(["ru", "be", "uk", "kk", "ky", "uz", "tg", "tk", "hy", "az"]);

export function languageFromTelegram(code: string | null | undefined): Language {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0];
  if (!base) return "ru";
  return russianFirst.has(base) ? "ru" : "en";
}

/** "ru" or "en"; anything else is not a language choice. */
export function parseLanguage(value: unknown): Language | null {
  return value === "ru" || value === "en" ? value : null;
}

/** The chosen language, otherwise the one Telegram reports. */
export function userLanguage(user: { language?: string | null; language_code?: string | null } | null | undefined): Language {
  return parseLanguage(user?.language) ?? languageFromTelegram(user?.language_code);
}

export function dateLocale(language: Language) {
  return language === "en" ? "en-GB" : "ru-RU";
}

/** Picks the text of the language: tr(language, "Открыть", "Open"). */
export function tr(language: Language, ru: string, en: string) {
  return language === "en" ? en : ru;
}
