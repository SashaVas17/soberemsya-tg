import { t } from "./i18n";

// Public Overpass servers do not serve cloud servers (Supabase gets 5xx,
// timeouts or «white-listed only»), so the administrator's app asks them
// itself, like overpass-turbo does, and the server only checks and saves
// the answer. The servers and queries come from the server (venues.ts);
// their hosts must be in csp.ts.

export type OverpassSource = { urls: string[]; queries: Record<string, string> };

type OverpassElement = { type?: unknown; id?: unknown; lat?: unknown; lon?: unknown; center?: unknown; tags?: unknown };

const OVERPASS_TIMEOUT_MS = 90_000;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return controller.signal;
}

/** Only what the server reads: smaller uploads from a phone. */
export function compactOverpassElements(elements: unknown[]) {
  return elements
    .filter((element): element is OverpassElement => Boolean(element) && typeof element === "object")
    .map(({ type, id, lat, lon, center, tags }) => ({ type, id, lat, lon, center, tags }));
}

/** Asks each Overpass server in turn; the error lists what every one answered. */
export async function fetchOverpassElements(
  urls: string[],
  query: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = OVERPASS_TIMEOUT_MS,
) {
  const failures: string[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    try {
      const response = await fetcher(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: timeoutSignal(timeoutMs),
      });
      if (!response.ok) {
        failures.push(`${host} ${response.status}`);
        continue;
      }
      const answer = (await response.json()) as { elements?: unknown; remark?: unknown } | null;
      if (!answer || !Array.isArray(answer.elements) || (typeof answer.remark === "string" && /error/i.test(answer.remark))) {
        failures.push(`${host} ${t("ошибка в ответе")}`);
        continue;
      }
      return compactOverpassElements(answer.elements);
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
      failures.push(`${host} ${timedOut ? t("нет ответа") : t("нет связи")}`);
    }
  }
  throw new Error(t("OpenStreetMap не ответил ({details}). Попробуйте через несколько минут.", { details: failures.join(", ") }));
}
