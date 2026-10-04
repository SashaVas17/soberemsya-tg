type SessionExpiredListener = () => void;

const listeners = new Set<SessionExpiredListener>();

/** Telegram initData is signed once per launch; a 401 means it went stale. */
export function isSessionExpiredStatus(status: number) {
  return status === 401;
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
