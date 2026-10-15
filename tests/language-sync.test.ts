import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { languageSync } from "../src/i18n.ts";

const read = (path: string) => readFileSync(path, "utf8");

describe("language choice between the device and the server", () => {
  it("takes the server choice on a device without its own", () => {
    expect(languageSync("auto", "en")).toEqual({ adopt: "en" });
    expect(languageSync("auto", null)).toBeNull();
  });

  it("sends the device choice when the server lacks or differs", () => {
    expect(languageSync("en", null)).toEqual({ send: "en" });
    expect(languageSync("ru", "en")).toEqual({ send: "ru" });
    expect(languageSync("en", "en")).toBeNull();
  });

  it("does nothing with a server that does not know languages", () => {
    expect(languageSync("en", undefined)).toBeNull();
    expect(languageSync("auto", undefined)).toBeNull();
  });

  it("sends the language with every request and saves the choice without blocking the app", () => {
    const api = read("src/api.ts");
    expect(api).toContain('"x-flockly-language": language(),');
    expect(api).toContain('request<{ language: Language | null }>("/me/language", {');
    const app = read("src/App.tsx");
    expect(app).toContain('api.saveLanguage(next === "auto" ? null : next).catch(() => undefined);');
    expect(app).toContain("const sync = languageSync(readLanguagePreference(), result.language);");
  });
});
