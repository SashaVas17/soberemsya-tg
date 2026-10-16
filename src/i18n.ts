import { en, enPlurals } from "./i18n-en";
import { telegram } from "./telegram";

// Interface language. Texts are written in Russian in the code and looked up
// by that text (gettext style): `t("Создать встречу")`. A missing translation
// falls back to Russian. Data from the server (meeting titles, venue names)
// is shown as is; server messages known to the dictionary are translated too.

export type Language = "ru" | "en";
export type LanguagePreference = Language | "auto";

export const LANGUAGE_STORAGE_KEY = "flockly.language";

// Telegram languages that read Russian more easily than English.
// Same list on the server (supabase/functions/_shared/i18n.ts) and in the bot
// setup scripts; tests/server-language.test.ts keeps them equal.
export const RUSSIAN_FIRST_LANGUAGES = ["ru", "be", "uk", "kk", "ky", "uz", "tg", "tk", "hy", "az"];
const russianFirst = new Set(RUSSIAN_FIRST_LANGUAGES);

export function languageFromTelegram(code: string | null | undefined): Language {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0];
  if (!base) return "ru";
  return russianFirst.has(base) ? "ru" : "en";
}

type LanguageStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): LanguageStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLanguagePreference(store: LanguageStorage | null = storage()): LanguagePreference {
  try {
    const value = store?.getItem(LANGUAGE_STORAGE_KEY);
    return value === "ru" || value === "en" ? value : "auto";
  } catch {
    return "auto";
  }
}

function telegramLanguageCode() {
  if (typeof window === "undefined") return null;
  return telegram()?.initDataUnsafe?.user?.language_code ?? null;
}

export function resolveLanguage(preference: LanguagePreference, telegramCode: string | null | undefined): Language {
  return preference === "auto" ? languageFromTelegram(telegramCode) : preference;
}

let current: Language = resolveLanguage(readLanguagePreference(), telegramLanguageCode());
if (typeof document !== "undefined") document.documentElement.lang = current;

/** Resolves «auto» again once Telegram is initialized (its data may come late). */
export function refreshLanguage() {
  setLanguage(resolveLanguage(readLanguagePreference(), telegramLanguageCode()));
  return current;
}

export function language(): Language {
  return current;
}

/** For tests; the app sets the language through saveLanguagePreference. */
export function setLanguage(next: Language) {
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

export function saveLanguagePreference(preference: LanguagePreference, store: LanguageStorage | null = storage()) {
  try {
    if (preference === "auto") store?.removeItem(LANGUAGE_STORAGE_KEY);
    else store?.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Private mode: the choice lasts until the Mini App closes.
  }
  setLanguage(resolveLanguage(preference, telegramLanguageCode()));
}

/** Set once the device choice is known to be saved on the server. */
export const LANGUAGE_SYNCED_KEY = "flockly.language.synced";

export function readLanguageSynced(store: LanguageStorage | null = storage()) {
  try {
    return store?.getItem(LANGUAGE_SYNCED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLanguageSynced(synced: boolean, store: LanguageStorage | null = storage()) {
  try {
    if (synced) store?.setItem(LANGUAGE_SYNCED_KEY, "1");
    else store?.removeItem(LANGUAGE_SYNCED_KEY);
  } catch {
    // Private mode: the next sign-in compares again.
  }
}

export type LanguageSync = { adopt: LanguagePreference } | { send: Language | null } | null;

/**
 * After sign-in. Once this device's choice reached the server, the server
 * holds the latest one (it may come from another device) and is adopted.
 * A choice that never reached it (made before step 2, or a failed save) is
 * sent. `server` is undefined for a server that does not know languages.
 */
export function languageSync(local: LanguagePreference, synced: boolean, server: Language | null | undefined): LanguageSync {
  if (server === undefined) return null;
  const serverPreference: LanguagePreference = server ?? "auto";
  if (synced || local === "auto") return serverPreference === local ? null : { adopt: serverPreference };
  return local === server ? null : { send: local };
}

/** Locale for dates and numbers. */
export function locale() {
  return current === "en" ? "en-GB" : "ru-RU";
}

type Params = Record<string, string | number>;

// Object.hasOwn is missing in older Telegram WebViews (iOS < 15.4).
const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** The text in the current language; {name} placeholders are filled from params. */
export function t(text: string, params?: Params): string {
  // Own keys only: a server text like "constructor" must not hit Object.prototype.
  const template = current === "en" && has(en, text) ? en[text] : text;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, key: string) =>
    key in params ? String(params[key]) : match);
}

/**
 * "5 участников" / "5 participants". The Russian forms are one, few, many;
 * English forms come from the dictionary by the Russian "one" form.
 */
export function plural(count: number, one: string, few: string, many: string) {
  if (current === "en" && has(enPlurals, one)) {
    const forms = enPlurals[one];
    return `${count} ${count === 1 ? forms[0] : forms[1]}`;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many}`;
}
