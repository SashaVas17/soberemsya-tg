import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { languageSync, readLanguageSynced, writeLanguageSynced } from "../src/i18n.ts";

const read = (path: string) => readFileSync(path, "utf8");

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("language choice between the device and the server", () => {
  it("adopts the server once this device's choice reached it", () => {
    // Device B adopted «en», then the person chose «auto» on device A.
    expect(languageSync("en", true, null)).toEqual({ adopt: "auto" });
    // A newer choice made on another device wins.
    expect(languageSync("ru", true, "en")).toEqual({ adopt: "en" });
    expect(languageSync("en", true, "en")).toBeNull();
  });

  it("takes the server choice on a device without its own", () => {
    expect(languageSync("auto", false, "en")).toEqual({ adopt: "en" });
    expect(languageSync("auto", false, null)).toBeNull();
  });

  it("sends a choice that never reached the server", () => {
    expect(languageSync("en", false, null)).toEqual({ send: "en" });
    expect(languageSync("ru", false, "en")).toEqual({ send: "ru" });
    expect(languageSync("en", false, "en")).toBeNull();
  });

  it("does nothing with a server that does not know languages", () => {
    expect(languageSync("en", false, undefined)).toBeNull();
    expect(languageSync("auto", true, undefined)).toBeNull();
  });

  it("remembers whether the choice is saved", () => {
    const store = memoryStore();
    expect(readLanguageSynced(store)).toBe(false);
    writeLanguageSynced(true, store);
    expect(readLanguageSynced(store)).toBe(true);
    writeLanguageSynced(false, store);
    expect(readLanguageSynced(store)).toBe(false);
  });

  it("sends the language with every request and saves choices in order without blocking the app", () => {
    expect(read("src/api.ts")).toContain('"x-flockly-language": language(),');
    const saver = read("src/language-preference.ts");
    expect(saver).toContain(".then(() => api.saveLanguage(preference === \"auto\" ? null : preference))");
    expect(saver).toContain("if (request === latest) writeLanguageSynced(true);");
    const app = read("src/App.tsx");
    expect(app).toContain("void saveLanguageOnServer(next);");
    expect(app).toContain("const sync = languageSync(readLanguagePreference(), readLanguageSynced(), result.language);");
  });
});
