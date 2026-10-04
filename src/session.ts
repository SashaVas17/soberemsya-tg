type SessionExpiredListener = () => void;

const listeners = new Set<SessionExpiredListener>();

import { ApiError } from "./api-error";

/**
 * Telegram signs initData once per launch. Only a correctly signed but stale
 * initData is fixed by reopening the app; other 401s keep the normal error UI.
 */
export function isSessionExpiredError(error: unknown) {
  return error instanceof ApiError &&
    error.status === 401 &&
    error.code === "TELEGRAM_SESSION_EXPIRED";
}

export function onSessionExpired(listener: SessionExpiredListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySessionExpired() {
  for (const listener of listeners) listener();
}
