import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./api";
import { hasApiErrorCode } from "./api-error";
import { telegram } from "./telegram";
import {
  applyTheme,
  initialResolvedTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToTelegramTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";
import type { EventData, PublicEventPreview } from "./types";
import type { Navigate } from "./app-types";
import { t } from "./i18n";

/**
 * Changes the screen inside a View Transition (theme-sunset.css: the old screen
 * fades out, the new one fades in 6 px up). Without the API (older WebViews) or
 * with reduced motion the screen changes at once, as before.
 */
function screenTransitions() {
  return typeof document.startViewTransition === "function" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;
}

function changeScreen(update: () => void) {
  if (screenTransitions()) document.startViewTransition(() => flushSync(update));
  else update();
}

export function usePath() {
  const readPath = () => {
    const value = window.location.hash.slice(1);
    return value.startsWith("/") ? value : "/";
  };
  const initialPath = useRef(readPath());
  const historyStack = useRef([initialPath.current]);
  const currentPath = useRef(initialPath.current);
  const [path, setPath] = useState(initialPath.current);
  useEffect(() => {
    const onHashChange = () => {
      const next = readPath();
      if (next === currentPath.current) return;
      const previousIndex = historyStack.current.lastIndexOf(next);
      if (previousIndex >= 0) historyStack.current.splice(previousIndex + 1);
      else historyStack.current.push(next);
      currentPath.current = next;
      changeScreen(() => setPath(next));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = useCallback<Navigate>((next, replace = false) => {
    if (next === currentPath.current && !replace) return;
    if (replace) historyStack.current[historyStack.current.length - 1] = next;
    else historyStack.current.push(next);
    currentPath.current = next;
    const target = `#${next}`;
    if (replace)
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${target}`);
    else window.location.hash = next;
    if (screenTransitions()) {
      // Inside a transition the new screen is shown from the top at once.
      changeScreen(() => {
        setPath(next);
        window.scrollTo(0, 0);
      });
    } else {
      setPath(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);
  const goBack = useCallback(() => {
    if (historyStack.current.length <= 1) {
      navigate("/", true);
      return;
    }
    historyStack.current.pop();
    navigate(historyStack.current[historyStack.current.length - 1], true);
  }, [navigate]);
  return { path, navigate, goBack };
}

export function useTelegramBack(
  path: string,
  goBack: () => void,
  override: (() => void) | null,
) {
  useEffect(() => {
    const button = telegram()?.BackButton;
    if (!button) return;
    const back = () => {
      if (override) {
        override();
        return;
      }
      goBack();
    };
    if (path === "/") button.hide();
    else {
      button.show();
      button.onClick(back);
    }
    return () => button.offClick(back);
  }, [goBack, override, path]);
}

export function useMainButton(
  label: string,
  enabled: boolean,
  action: () => void,
  visible = true,
) {
  useEffect(() => {
    const button = telegram()?.MainButton;
    if (!button || !visible) return;
    button.setText(label);
    if (enabled) button.enable();
    else button.disable();
    button.show();
    button.onClick(action);
    return () => {
      button.offClick(action);
      button.hide();
    };
  }, [action, enabled, label, visible]);
}

export function useAppTheme() {
  const preference = useRef<ThemePreference>(readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    initialResolvedTheme(telegram()),
  );
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);
  useEffect(
    () =>
      subscribeToTelegramTheme(
        telegram(),
        () => preference.current,
        setResolvedTheme,
      ),
    [],
  );
  const [themePreference, setPreferenceState] = useState<ThemePreference>(preference.current);
  // "auto" follows Telegram again; light or dark is kept on this device.
  const setThemePreference = useCallback((next: ThemePreference) => {
    preference.current = next;
    saveThemePreference(next);
    setPreferenceState(next);
    setResolvedTheme(resolveTheme(next, telegram()?.colorScheme ?? null));
  }, []);
  return { resolvedTheme, themePreference, setThemePreference };
}

export function useEvent(eventId: string) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const result = await api.event(eventId);
        setEvent(result.event);
        setError("");
        setLastUpdated(new Date());
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : t("Не удалось загрузить встречу."),
        );
      } finally {
        setRefreshing(false);
      }
    },
    [eventId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { event, setEvent, error, setError, refreshing, lastUpdated, load };
}

export function useParticipantEvent(eventId: string) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [preview, setPreview] = useState<PublicEventPreview | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.event(eventId);
      setEvent(result.event);
      setPreview(null);
      setError("");
    } catch (reason) {
      if (!hasApiErrorCode(reason, "PUBLIC_PREVIEW_REQUIRED")) {
        setError(
          reason instanceof Error
            ? reason.message
            : t("Не удалось загрузить встречу."),
        );
        return;
      }
      try {
        const result = await api.publicEventPreview(eventId);
        setEvent(null);
        setPreview(result.preview);
        setError("");
      } catch (previewError) {
        setError(
          previewError instanceof Error
            ? previewError.message
            : t("Не удалось загрузить встречу."),
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [eventId]);
  useEffect(() => {
    void load();
  }, [load]);
  return {
    event,
    setEvent,
    preview,
    setPreview,
    error,
    setError,
    refreshing,
    load,
  };
}
