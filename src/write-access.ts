import { requestBotWriteAccess } from "./telegram";

export const WRITE_ACCESS_ASKED_KEY = "soberemsya-write-access-asked";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): FlagStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Asks once, after the first action that benefits from notifications, for
 * permission to message the user from the bot, and reports a grant.
 */
export async function askWriteAccessOnce(
  report: () => Promise<unknown>,
  ask: () => Promise<boolean | null> = requestBotWriteAccess,
  storage: FlagStorage | null = browserStorage(),
) {
  try {
    if (storage?.getItem(WRITE_ACCESS_ASKED_KEY)) return null;
  } catch {
    return null;
  }
  const granted = await ask();
  // A client that cannot ask (null) will be asked again on a newer client.
  if (granted === null) return null;
  try {
    storage?.setItem(WRITE_ACCESS_ASKED_KEY, "1");
  } catch {
    // Asking again next time is harmless.
  }
  if (granted) await report().catch(() => undefined);
  return granted;
}
