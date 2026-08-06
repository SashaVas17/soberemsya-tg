type BackButton = { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
type MainButton = { setText(text: string): void; show(): void; hide(): void; enable(): void; disable(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  close(): void;
  openTelegramLink(url: string): void;
  BackButton: BackButton;
  MainButton: MainButton;
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
  document.documentElement.dataset.telegramTheme = app?.colorScheme ?? "light";
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
