import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { apiErrorFromBody } from "../src/api-error";
import { en, enPlurals } from "../src/i18n-en";
import {
  LANGUAGE_STORAGE_KEY,
  language,
  languageFromTelegram,
  locale,
  plural,
  readLanguagePreference,
  resolveLanguage,
  saveLanguagePreference,
  setLanguage,
  t,
} from "../src/i18n";

const cyrillic = /[А-Яа-яЁё]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Russian string literals of a file, except those passed to plural(). */
function russianLiterals(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { text: string; wrapped: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && cyrillic.test(node.text)) {
      const parent = node.parent;
      const call = ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) ? parent.expression.text : "";
      if (call !== "plural" && !ts.isLiteralTypeNode(parent)) found.push({ text: node.text, wrapped: call === "t" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const appFiles = sourceFiles("src").filter((path) => !/i18n|mock-api|vite-env/.test(path));

describe("interface texts", () => {
  afterEach(() => setLanguage("ru"));

  it("has an English text for every Russian text of the app", () => {
    const missing = appFiles.flatMap((path) =>
      russianLiterals(path).filter(({ text }) => !(text in en) && text !== "Русский").map(({ text }) => `${path}: ${text}`));
    expect(missing).toEqual([]);
  });

  it("has an English text for every server message the app may show", () => {
    // Bot and notification texts are not shown in the app (step 2 of the translation).
    const serverFiles = sourceFiles("supabase/functions").filter((path) =>
      !/notification-messages|share-card|group-chats|telegram-bot|notifications-worker|admin-stats/.test(path));
    const missing = serverFiles.flatMap((path) =>
      russianLiterals(path).filter(({ text }) => !(text in en)).map(({ text }) => `${path}: ${text}`));
    expect(missing).toEqual([]);
  });

  it("leaves no Russian text in JSX outside t()", () => {
    const bare = appFiles.filter((path) => path.endsWith(".tsx")).flatMap((path) => {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const texts: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && cyrillic.test(node.text)) texts.push(`${path}: ${node.text.trim()}`);
        ts.forEachChild(node, visit);
      };
      visit(source);
      return texts;
    });
    expect(bare).toEqual([]);
  });

  it("keeps placeholders the same in both languages", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const mismatched = Object.entries(en).filter(([ru, english]) => names(ru).join() !== names(english).join());
    expect(mismatched).toEqual([]);
  });

  it("has English plural forms for every plural() in the app", () => {
    const ones = appFiles.flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/plural\([^,]+,\s*"([^"]+)"/g)].map((match) => match[1]));
    expect(ones.length).toBeGreaterThan(0);
    expect(ones.filter((one) => !enPlurals[one])).toEqual([]);
  });
});

describe("language choice", () => {
  afterEach(() => setLanguage("ru"));

  it("reads Russian for Russian-first Telegram languages and English otherwise", () => {
    for (const code of ["ru", "be", "uk", "kk", "uz", "ru-RU", "UK"]) expect(languageFromTelegram(code)).toBe("ru");
    for (const code of ["en", "de", "pl", "en-US", "lt"]) expect(languageFromTelegram(code)).toBe("en");
    expect(languageFromTelegram(undefined)).toBe("ru");
    expect(resolveLanguage("auto", "de")).toBe("en");
    expect(resolveLanguage("ru", "de")).toBe("ru");
    expect(resolveLanguage("en", "ru")).toBe("en");
  });

  it("keeps the choice on the device and forgets it for «Как в Telegram»", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(readLanguagePreference(storage)).toBe("auto");
    saveLanguagePreference("en", storage);
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(readLanguagePreference(storage)).toBe("en");
    expect(language()).toBe("en");
    saveLanguagePreference("auto", storage);
    expect(store.has(LANGUAGE_STORAGE_KEY)).toBe(false);
    store.set(LANGUAGE_STORAGE_KEY, "fr");
    expect(readLanguagePreference(storage)).toBe("auto");
  });

  it("translates texts, fills placeholders and falls back to Russian", () => {
    setLanguage("en");
    expect(t("Создать встречу")).toBe("Create meeting");
    expect(t("Шаг {step} из 3", { step: 2 })).toBe("Step 2 of 3");
    expect(t("Текст без перевода")).toBe("Текст без перевода");
    expect(plural(1, "участник", "участника", "участников")).toBe("1 participant");
    expect(plural(5, "участник", "участника", "участников")).toBe("5 participants");
    expect(locale()).toBe("en-GB");
    setLanguage("ru");
    expect(t("Шаг {step} из 3", { step: 2 })).toBe("Шаг 2 из 3");
    expect(plural(22, "участник", "участника", "участников")).toBe("22 участника");
    expect(locale()).toBe("ru-RU");
  });

  it("shows known server messages in the interface language", () => {
    setLanguage("en");
    expect(apiErrorFromBody(404, { error: "Встреча не найдена или удалена." }).message).toBe("Meeting not found or deleted.");
    expect(apiErrorFromBody(400, { error: "Неизвестный текст сервера" }).message).toBe("Неизвестный текст сервера");
    expect(apiErrorFromBody(500, {}).message).toBe("Could not complete the action.");
  });
});

describe("settings screen", () => {
  const settings = readFileSync("src/screens/SettingsScreen.tsx", "utf8");
  const header = readFileSync("src/ui/common.tsx", "utf8");

  it("puts language, theme and notifications behind the corner button", () => {
    expect(header).toContain('onClick={() => navigate("/settings")}');
    expect(header).not.toContain("toggleTheme");
    expect(settings).toContain("<NotificationSettingsPanel />");
    expect(settings).toMatch(/value: "auto", label: "Как в Telegram"/);
    expect(settings).toContain('{ value: "en", label: "English", native: true }');
    expect(settings).toContain("aria-pressed={value === choice.value}");
    // The note about Russian bot messages makes sense only in English.
    expect(settings).toContain('language() === "en" && <p className="settings-note">');
  });
});
