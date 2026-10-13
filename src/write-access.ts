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
    storage?.setItem(WRITE_ACCESS_ASKED_KEY, "1");
  } catch {
    return null;
  }
  const granted = await ask();
  if (granted) await report().catch(() => undefined);
  return granted;
}
