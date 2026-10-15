import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  languageFromTelegram as clientLanguageFromTelegram,
  RUSSIAN_FIRST_LANGUAGES as CLIENT_RUSSIAN_FIRST,
} from "../src/i18n.ts";
import { groupCommandReply, renderGroupMessage } from "../supabase/functions/_shared/group-chats.ts";
import {
  dateLocale,
  languageFromTelegram,
  parseLanguage,
  RUSSIAN_FIRST_LANGUAGES,
  tr,
  userLanguage,
} from "../supabase/functions/_shared/i18n.ts";
import { meetingListItem } from "../supabase/functions/_shared/meeting-list.ts";
import { reportReasonLabel } from "../supabase/functions/_shared/moderation.ts";
import { formatFinalDetails, type NotificationKind, renderNotification } from "../supabase/functions/_shared/notification-messages.ts";
import { publicDateSummary } from "../supabase/functions/_shared/public-preview.ts";
import { buildShareCard } from "../supabase/functions/_shared/share-card.ts";

const read = (path: string) => readFileSync(path, "utf8");
const cyrillic = /[А-Яа-яЁё]/;
const startsAt = "2026-10-24T15:00:00Z"; // Saturday 18:00 in Minsk

describe("server language rule", () => {
  it("keeps one list of Russian-first languages in the app, the server and the bot scripts", () => {
    expect(RUSSIAN_FIRST_LANGUAGES).toEqual(CLIENT_RUSSIAN_FIRST);
    expect(read("scripts/configure-telegram.sh")).toContain(`for language in ${RUSSIAN_FIRST_LANGUAGES.join(" ")}; do`);
    expect(read("scripts/configure-telegram.ps1"))
      .toContain(`foreach ($language in @(${RUSSIAN_FIRST_LANGUAGES.map((code) => `"${code}"`).join(", ")}))`);
  });

  it("matches the app: CIS Telegram languages read Russian, the rest English", () => {
    for (const code of ["ru", "be", "uk-UA", "kk", "en", "de", "pl", "", null, undefined])
      expect(languageFromTelegram(code), String(code)).toBe(clientLanguageFromTelegram(code));
  });

  it("prefers the chosen language over Telegram's", () => {
    expect(userLanguage({ language: "en", language_code: "ru" })).toBe("en");
    expect(userLanguage({ language: null, language_code: "de" })).toBe("en");
    expect(userLanguage({ language: "xx", language_code: "ru" })).toBe("ru");
    expect(userLanguage(null)).toBe("ru");
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("EN")).toBeNull();
    expect(dateLocale("en")).toBe("en-GB");
    expect(tr("en", "Да", "Yes")).toBe("Yes");
  });
});

describe("notifications", () => {
  const kinds: NotificationKind[] = [
    "response_each", "response_summary", "join_request_new", "join_request_approved", "join_request_rejected",
    "event_decided", "event_cancelled", "event_updated", "event_reopened", "reminder_24h", "reminder_2h", "report_new",
  ];
  const payload = { title: "Coffee", answered: 3, available: 2, declined: 1, requester: "Ann", startsAt, place: "Park", area: "Centre", reason: "spam", targetType: "user", targetName: "Bob" };

  it("has an English text and button for every kind, without Russian left", () => {
    for (const kind of kinds) {
      const message = renderNotification(kind, payload, "https://t.me/x/app", "en");
      expect(message.text, kind).not.toMatch(cyrillic);
      expect(message.buttonText, kind).not.toMatch(cyrillic);
      expect(message.text, kind).toContain("“Coffee”");
    }
  });

  it("keeps Russian by default", () => {
    expect(renderNotification("event_cancelled", { title: "Кофе" }, "u").text).toBe("Встреча «Кофе» отменена организатором.");
  });

  it("formats the final time in the language", () => {
    expect(formatFinalDetails(startsAt, "Park", "Centre", "en")).toMatch(/^Saturday,? 24 October(,| at) 18:00 · Park, Centre$/);
    const russian = formatFinalDetails(startsAt, "Парк", null);
    expect(russian).toMatch(/^суббота, 24 октября.* 18:00 · Парк$/);
    expect(russian).toBe(formatFinalDetails(startsAt, "Парк", null, "ru"));
    expect(reportReasonLabel("fraud", "en")).toBe("Fraud");
    expect(reportReasonLabel("unknown", "en")).toBe("Other");
  });
});

describe("group messages and bot replies", () => {
  it("renders group cards and results in English", () => {
    const card = renderGroupMessage("group_card", { title: "Board games", organizer: "Ann" }, "u", "en");
    expect(card).toEqual({ text: "Ann suggests a meeting “Board games”.\nMark the time and place that suit you.", buttonText: "Vote", url: "u" });
    const result = renderGroupMessage("group_decided", { title: "Board games" }, "u", "en");
    expect(result.text).toBe("The meeting “Board games” is set.");
    expect(renderGroupMessage("group_card", { title: "Игры" }, "u").text).toBe("Новая встреча «Игры».\nОтметьте удобное время и место.");
  });

  it("answers group commands in English", () => {
    for (const [command, link] of [["/new", "https://t.me/x/app?startapp=group_t"], ["/new", null], ["/help", null]] as const) {
      const reply = groupCommandReply(command, "https://t.me/x/app", link, "en");
      expect(reply?.text, command).not.toMatch(cyrillic);
      expect(JSON.stringify(reply?.reply_markup ?? {}), command).not.toMatch(cyrillic);
    }
  });

  it("answers private commands in the sender's language", () => {
    const bot = read("supabase/functions/telegram-bot/index.ts");
    expect(bot).toContain("const reply = privateCommandReply(command, await senderLanguage(message));");
    expect(bot).toContain("languageCode: typeof sender?.language_code === \"string\" ? sender.language_code : null,");
    expect(bot).toContain("createUrl, await senderLanguage(message));");
  });
});

describe("share cards and date summaries", () => {
  it("builds an English share card", () => {
    const invite = buildShareCard("invite", { title: "Coffee", description: "" }, "u", "id", "en");
    expect(invite.input_message_content.message_text).toBe("Shall we meet? “Coffee”\nMark the time and place that suit you.");
    expect(JSON.stringify(invite)).not.toMatch(cyrillic);
    const result = buildShareCard("result", { title: "Coffee", description: "", startsAt, place: "Park" }, "u", "id", "en");
    expect(JSON.stringify(result)).not.toMatch(cyrillic);
  });

  it("writes month names in the language", () => {
    const later = "2026-10-26T15:00:00Z";
    expect(publicDateSummary([startsAt, later], "Europe/Minsk", "en")).toBe("24–26 October");
    expect(publicDateSummary([startsAt, later])).toBe("24–26 октября");
    const item = meetingListItem({
      id: "e", title: "t", status: "decided", finalPlaceId: "p", finalTimeOptionId: "t1",
      timeOptions: [{ id: "t1", startsAt, availableCount: 1 }], placeOptions: [{ id: "p", title: "Park" }],
      participants: [], createdAt: startsAt,
    }, "owner", "en");
    expect(item.timeSummary).toBe("24 October · 18:00");
  });
});

describe("API and worker wiring", () => {
  const api = read("supabase/functions/telegram-api/index.ts");
  const worker = read("supabase/functions/notifications-worker/index.ts");

  it("takes the request language from the app header, otherwise from Telegram", () => {
    expect(api).toContain("language: parseLanguage(request.headers.get(LANGUAGE_HEADER)) ?? languageFromTelegram(profile.language_code),");
    expect(api).toContain('if (path === "/me/language") return ["PUT"];');
    expect(api).toContain('db.rpc("set_user_language", { p_user_id: auth.user.id, p_language: language })');
    expect(api).toContain("language: await storedLanguage(auth.user.id),");
  });

  it("renders queued messages in the recipient's or organizer's language", () => {
    expect(worker).toContain('languages.get(String(item.telegram_user_id)) ?? "ru"');
    expect(worker).toContain('languages.get(item.event_id) ?? "ru"');
  });

  it("stores the choice through a server-only RPC", () => {
    const sql = read("supabase/migrations/20261015132427_user_language.sql");
    expect(sql).toContain("add column if not exists language text check (language in ('ru', 'en'))");
    expect(sql).toContain("security definer set search_path = pg_catalog, public");
    expect(sql).toContain("revoke all on function public.set_user_language(uuid, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.set_user_language(uuid, text) to service_role;");
    expect(sql).not.toMatch(/\b(drop|delete from|raise)\b/i);
  });
});
