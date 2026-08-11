export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type TelegramColorScheme = "light" | "dark";

export const THEME_STORAGE_KEY = "soberemsya.theme-preference";

export type ThemeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type ThemeTarget = {
  dataset: Record<string, string | undefined>;
};

export type TelegramThemeSource = {
  colorScheme: TelegramColorScheme;
  onEvent?: (event: "themeChanged", listener: () => void) => void;
  offEvent?: (event: "themeChanged", listener: () => void) => void;
};

function browserStorage(): ThemeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

export function readThemePreference(
  storage: ThemeStorage | null = browserStorage(),
): ThemePreference {
  if (!storage) return "auto";
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = browserStorage(),
) {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme persistence must never prevent the Mini App from opening.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  telegramColorScheme?: TelegramColorScheme | null,
): ResolvedTheme {
  if (preference !== "auto") return preference;
  return telegramColorScheme === "dark" ? "dark" : "light";
}

export function applyTheme(
  theme: ResolvedTheme,
  target: ThemeTarget = document.documentElement,
) {
  target.dataset.theme = theme;
}

export function initialResolvedTheme(
  source: TelegramThemeSource | null,
  storage?: ThemeStorage | null,
) {
  return resolveTheme(
    readThemePreference(storage),
    source?.colorScheme ?? null,
  );
}

export function subscribeToTelegramTheme(
  source: TelegramThemeSource | null,
  getPreference: () => ThemePreference,
  onTheme: (theme: ResolvedTheme) => void,
) {
  if (!source?.onEvent || !source.offEvent) return () => undefined;
  const onThemeChanged = () => {
    const preference = getPreference();
    if (preference === "auto")
      onTheme(resolveTheme(preference, source.colorScheme));
  };
  source.onEvent("themeChanged", onThemeChanged);
  return () => source.offEvent?.("themeChanged", onThemeChanged);
}
