type BackButton = { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
type MainButton = { setText(text: string): void; show(): void; hide(): void; enable(): void; disable(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  close(): void;
  requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
  openLink?: (url: string) => void;
  openTelegramLink(url: string): void;
  isVersionAtLeast?: (version: string) => boolean;
  shareMessage?: (preparedMessageId: string, callback?: (sent: boolean) => void) => void;
  BackButton: BackButton;
  MainButton: MainButton;
  onEvent?: (event: "themeChanged", callback: () => void) => void;
  offEvent?: (event: "themeChanged", callback: () => void) => void;
  HapticFeedback?: { notificationOccurred(type: "error" | "success" | "warning"): void; impactOccurred(style: "light" | "medium" | "heavy"): void };
};

declare global { interface Window { Telegram?: { WebApp: TelegramWebApp } } }

export function telegram() { return window.Telegram?.WebApp ?? null; }

export function initializeTelegram() {
  const app = telegram();
  try {
    app?.ready?.();
    app?.expand?.();
  } catch (error) {
    console.warn("Telegram WebApp initialization failed", error);
  }
  return app;
}

export function haptic(type: "error" | "success" | "warning" = "success") {
  telegram()?.HapticFeedback?.notificationOccurred(type);
}

export function openTelegramUrl(url: string) {
  const app = telegram();
  if (app) app.openTelegramLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function openExternalUrl(url: string) {
  const app = telegram();
  try {
    if (app?.openLink) {
      app.openLink(url);
      return;
    }
  } catch {
    // Telegram WebView can reject an external navigation; use the browser fallback.
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Asks Telegram for permission to message the user from the bot. Resolves
 * to null when this Telegram client cannot ask (outside Telegram or too old).
 */
export function requestBotWriteAccess(): Promise<boolean | null> {
  const app = telegram();
  if (!app?.requestWriteAccess) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      app.requestWriteAccess?.((granted) => resolve(Boolean(granted)));
    } catch {
      resolve(null);
    }
  });
}

/** WebApp.shareMessage (Bot API 8.0+) sends a prepared card to any chat. */
export function canShareMessage() {
  const app = telegram();
  return Boolean(app?.shareMessage && app.isVersionAtLeast?.("8.0"));
}

/** Resolves to null when the client could not open the share dialog. */
export function shareTelegramMessage(preparedMessageId: string): Promise<boolean | null> {
  const app = telegram();
  if (!app?.shareMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      app.shareMessage?.(preparedMessageId, (sent) => resolve(Boolean(sent)));
    } catch {
      resolve(null);
    }
  });
}
