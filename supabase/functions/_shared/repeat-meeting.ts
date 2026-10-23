// «Собрать ещё раз»: a new meeting made from an old one invites the old
// meeting's people (RPC invite_previous_participants, notification
// event_repeated).

const EVENT_ID = /^[A-Za-z0-9_-]{3,80}$/;

/** The meeting the new one is gathered from; absent for a plain create. */
export function parseRepeatOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !EVENT_ID.test(value))
    throw Object.assign(new Error("Некорректная встреча для повтора."), { status: 400 });
  return value;
}

/** Our own error token from the RPC, never other database text. */
export function repeatErrorToken(error: { code?: string; message?: string }) {
  if (error.code !== "P0001") return "unknown";
  return error.message === "REPEAT_EVENT_INVALID" || error.message === "RATE_LIMITED:event_repeat"
    ? error.message
    : "unknown";
}
