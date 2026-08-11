import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  initialResolvedTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToTelegramTheme,
  type ResolvedTheme,
  type TelegramColorScheme,
  type ThemePreference,
  type ThemeStorage,
} from "../src/theme";

function memoryStorage(initial?: string): ThemeStorage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(THEME_STORAGE_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function telegramTheme(initial: TelegramColorScheme) {
  const listeners = new Set<() => void>();
  return {
    source: {
      colorScheme: initial,
      onEvent: (_event: "themeChanged", listener: () => void) =>
        void listeners.add(listener),
      offEvent: (_event: "themeChanged", listener: () => void) =>
        void listeners.delete(listener),
    },
    emit(colorScheme: TelegramColorScheme) {
      this.source.colorScheme = colorScheme;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

describe("theme preference", () => {
  it("defaults to auto", () => {
    expect(readThemePreference(memoryStorage())).toBe("auto");
  });

  it("resolves Telegram light to light", () => {
    expect(resolveTheme("auto", "light")).toBe("light");
  });

  it("resolves Telegram dark to dark", () => {
    expect(resolveTheme("auto", "dark")).toBe("dark");
  });

  it("updates the resolved theme after themeChanged in auto", () => {
    const telegram = telegramTheme("light");
    let resolved: ResolvedTheme = "light";
    const cleanup = subscribeToTelegramTheme(
      telegram.source,
      () => "auto",
      (theme) => {
        resolved = theme;
      },
    );

    telegram.emit("dark");

    expect(resolved).toBe("dark");
    cleanup();
  });

  it("does not change manual light after themeChanged", () => {
    const telegram = telegramTheme("light");
    let resolved: ResolvedTheme = "light";
    const cleanup = subscribeToTelegramTheme(
      telegram.source,
      () => "light",
      (theme) => {
        resolved = theme;
      },
    );

    telegram.emit("dark");

    expect(resolved).toBe("light");
    cleanup();
  });

  it("does not change manual dark after themeChanged", () => {
    const telegram = telegramTheme("dark");
    let resolved: ResolvedTheme = "dark";
    const cleanup = subscribeToTelegramTheme(
      telegram.source,
      () => "dark",
      (theme) => {
        resolved = theme;
      },
    );

    telegram.emit("light");

    expect(resolved).toBe("dark");
    cleanup();
  });

  it("persists a manual preference", () => {
    const storage = memoryStorage();

    saveThemePreference("dark", storage);

    expect(readThemePreference(storage)).toBe("dark");
  });

  it("treats an invalid stored value as auto", () => {
    expect(readThemePreference(memoryStorage("sepia"))).toBe("auto");
  });

  it("uses safe light fallback outside Telegram", () => {
    expect(initialResolvedTheme(null, memoryStorage())).toBe("light");
  });

  it("removes the exact listener during cleanup", () => {
    const telegram = telegramTheme("light");
    let preference: ThemePreference = "auto";
    let resolved: ResolvedTheme = "light";
    const cleanup = subscribeToTelegramTheme(
      telegram.source,
      () => preference,
      (theme) => {
        resolved = theme;
      },
    );
    expect(telegram.listenerCount()).toBe(1);

    cleanup();
    telegram.emit("dark");

    expect(telegram.listenerCount()).toBe(0);
    expect(resolved).toBe("light");
    preference = "dark";
  });
});
