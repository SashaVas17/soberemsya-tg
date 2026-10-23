import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStartParam } from "../supabase/functions/_shared/domain";
import {
  groupCommandReply,
  groupCreateUrl,
  isGroupChatType,
  isGroupMessageStale,
  parseBotCommand,
  parseGroupToken,
  renderGroupMessage,
} from "../supabase/functions/_shared/group-chats";
import { classifyTelegramResult } from "../supabase/functions/_shared/notification-messages";
import { buildShareCard, parseShareCardKind } from "../supabase/functions/_shared/share-card";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const token = "AbCdEfGhIjKlMnOpQrStUv_-";
const schema = read("supabase/migrations/20261013135742_group_chats_schema.sql");
const rpc = read("supabase/migrations/20261013140338_group_chats_rpc.sql");
const api = read("supabase/functions/telegram-api/index.ts");
const bot = read("supabase/functions/telegram-bot/index.ts");
const worker = read("supabase/functions/notifications-worker/index.ts");

describe("bot commands in group chats", () => {
  it("accepts commands addressed to this bot only", () => {
    expect(parseBotCommand("/new", "soberemsyabelarusbot")).toBe("/new");
    expect(parseBotCommand("/NEW@SoberemsyaBelarusBot extra", "soberemsyabelarusbot")).toBe("/new");
    expect(parseBotCommand("/new@other_bot", "soberemsyabelarusbot")).toBeNull();
    expect(parseBotCommand("привет", "soberemsyabelarusbot")).toBeNull();
    expect(parseBotCommand("", "soberemsyabelarusbot")).toBeNull();
  });

  it("recognizes groups and supergroups", () => {
    expect(isGroupChatType("group")).toBe(true);
    expect(isGroupChatType("supergroup")).toBe(true);
    expect(isGroupChatType("private")).toBe(false);
    expect(isGroupChatType("channel")).toBe(false);
  });

  it("replies with url buttons only (web_app buttons are rejected in groups)", () => {
    const createUrl = groupCreateUrl("bot", "app", token);
    expect(createUrl).toBe(`https://t.me/bot/app?startapp=group_${token}`);
    const reply = groupCommandReply("/new", "https://t.me/bot/app", createUrl);
    expect(reply && "reply_markup" in reply && reply.reply_markup.inline_keyboard[0][0])
      .toEqual({ text: "Создать встречу", url: createUrl });
    expect(JSON.stringify(groupCommandReply("/new", "https://t.me/bot/app", null))).toContain("от своего имени");
    expect(JSON.stringify(groupCommandReply("/help", "https://t.me/bot/app", null))).not.toContain("web_app");
    expect(groupCommandReply("/unknown", "https://t.me/bot/app", null)).toBeNull();
    expect(bot).toContain("if (message.chatType !== \"private\") return json({ ok: true });");
  });

  it("keeps the startapp payload within Telegram limits", () => {
    expect(`group_${token}`.length).toBeLessThanOrEqual(64);
    expect(rpc).toContain("translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')");
  });
});

describe("group links", () => {
  it("parses event and group start parameters", () => {
    expect(parseStartParam(`group_${token}`)).toEqual({ type: "group", token });
    expect(parseStartParam("event_evt_1")).toEqual({ type: "event", eventId: "evt_1" });
    expect(parseStartParam(null)).toBeNull();
    expect(() => parseStartParam("group_short")).toThrow("Некорректная");
  });

  it("validates the optional group token of a create request", () => {
    expect(parseGroupToken(undefined)).toBeNull();
    expect(parseGroupToken("")).toBeNull();
    expect(parseGroupToken(token)).toBe(token);
    expect(() => parseGroupToken("../etc")).toThrow("Некорректная ссылка из группы");
    expect(() => parseGroupToken(42)).toThrow();
  });

  it("attaches only after the meeting exists, so a replay keeps its idempotency key", () => {
    const create = api.slice(api.indexOf("async function createEvent"), api.indexOf("async function createJoinRequest"));
    expect(create).not.toContain("groupLinkExpiredError");
    expect(create.indexOf("attachEventToGroup(")).toBeGreaterThan(create.indexOf("db.rpc("));
    expect(api).toContain('if (/^\\/group-links\\/[^/]+$/.test(path)) return ["GET"];');
  });
});

describe("group link ownership", () => {
  it("binds a link to the member who sent /new", () => {
    expect(schema).toContain("issuer_telegram_user_id bigint not null");
    expect(rpc).toContain("return 'not_issuer';");
    expect(rpc.indexOf("return 'not_issuer';")).toBeLessThan(rpc.indexOf("insert into public.event_group_chats"));
    expect(bot).toContain("p_issuer_telegram_user_id: message.senderId");
    expect(bot).toContain("sender.is_bot !== true");
    expect(api).toContain("if (!data.is_issuer) throw groupLinkNotIssuerError();");
  });

  it("re-queues a result skipped while the meeting was reopened, never a sent one", () => {
    expect(rpc).toContain("where public.group_message_outbox.status = 'skipped';");
  });
});

describe("group messages", () => {
  const url = "https://t.me/bot/app?startapp=event_evt_1";

  it("renders the card and the result", () => {
    const card = renderGroupMessage("group_card", { title: "Шашлыки", organizer: "Александр" }, url);
    expect(card.text).toContain("Александр предлагает встречу «Шашлыки»");
    expect(card.buttonText).toBe("Проголосовать");
    const result = renderGroupMessage(
      "group_decided",
      { title: "Шашлыки", startsAt: "2026-10-20T15:00:00Z", place: "Парк", area: "Центр" },
      url,
    );
    expect(result.text).toContain("Итог встречи «Шашлыки»: ");
    expect(result.text).toContain("18:00 · Парк, Центр");
    expect(result.url).toBe(url);
  });

  it("skips messages that no longer make sense", () => {
    expect(isGroupMessageStale("group_card", "collecting", false)).toBe(false);
    expect(isGroupMessageStale("group_card", "cancelled", false)).toBe(true);
    expect(isGroupMessageStale("group_card", "collecting", true)).toBe(true);
    expect(isGroupMessageStale("group_decided", "decided", false)).toBe(false);
    expect(isGroupMessageStale("group_decided", "collecting", false)).toBe(true);
  });

  it("follows a group that became a supergroup", () => {
    expect(classifyTelegramResult(400, { ok: false, parameters: { migrate_to_chat_id: -1001 } }))
      .toMatchObject({ outcome: "migrated", newChatId: -1001 });
    expect(classifyTelegramResult(400, { ok: false })).toMatchObject({ outcome: "failed" });
    expect(worker).toContain('completeGroup(item.id, "migrated", result.error, undefined, result.newChatId)');
    expect(rpc).toContain("elsif p_outcome = 'migrated' and p_new_chat_id is not null then");
  });

  it("posts only the card and the result to groups", () => {
    expect(schema).toContain("kind text not null check (kind in ('group_card', 'group_decided'))");
    expect(rpc).toContain("after update of status, final_time_option_id, final_place_id on public.events");
  });

  it("keeps group tables server-only", () => {
    for (const table of ["group_links", "event_group_chats", "group_message_outbox"]) {
      expect(schema).toContain(`alter table public.${table} enable row level security;`);
      expect(schema).toContain(`revoke all privileges on table public.${table} from public, anon, authenticated;`);
    }
  });
});

describe("share card", () => {
  const url = "https://t.me/bot/app?startapp=event_evt_1";

  it("builds an invite card with a vote button", () => {
    const card = buildShareCard("invite", { title: "Шашлыки", description: "Берём мангал" }, url, "r1");
    expect(card.type).toBe("article");
    expect(card.input_message_content.message_text).toBe("Соберёмся? «Шашлыки»\nБерём мангал\nОтметьте удобное время и место.");
    expect(card.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Проголосовать", url });
    // Without a create link the card keeps its single button.
    expect(card.reply_markup.inline_keyboard).toHaveLength(1);
  });

  it("builds a result card and shortens long descriptions", () => {
    const result = buildShareCard(
      "result",
      { title: "Шашлыки", description: "", startsAt: "2026-10-20T15:00:00Z", place: "Парк", area: null },
      url,
      "r2",
    );
    expect(result.input_message_content.message_text).toContain("Итог встречи «Шашлыки»: ");
    expect(result.input_message_content.message_text).toContain("· Парк.");
    const long = buildShareCard("invite", { title: "x", description: "а".repeat(500) }, url, "r3");
    expect(long.input_message_content.message_text.length).toBeLessThan(400);
  });

  it("validates the card kind", () => {
    expect(parseShareCardKind(undefined)).toBe("invite");
    expect(parseShareCardKind("result")).toBe("result");
    expect(() => parseShareCardKind("spam")).toThrow();
  });

  it("prepares the card for the signed-in user with read access", () => {
    const share = api.slice(api.indexOf("async function shareMessage"), api.indexOf("function apiPath("));
    expect(share).toContain("assertFullEventReadAccess(");
    expect(share).toContain("user_id: auth.user.telegram_user_id");
    expect(share).toContain("savePreparedInlineMessage");
  });
});
