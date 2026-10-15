import { api } from "./api";
import { type LanguagePreference, writeLanguageSynced } from "./i18n";

// Saves go one after another, so quick switches reach the server in the
// order they were made; only the last one marks the choice as saved.
let queue: Promise<unknown> = Promise.resolve();
let latest = 0;

export function saveLanguageOnServer(preference: LanguagePreference) {
  const request = ++latest;
  writeLanguageSynced(false);
  queue = queue
    .catch(() => undefined)
    .then(() => api.saveLanguage(preference === "auto" ? null : preference))
    .then(() => {
      if (request === latest) writeLanguageSynced(true);
    })
    // A failed save only leaves the bot in the previous language; the next
    // sign-in sends the choice again.
    .catch(() => undefined);
  return queue;
}
