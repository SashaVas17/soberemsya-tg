import { createAdminClient } from "../_shared/admin-client.ts";
import { errorResponse, json } from "../_shared/http.ts";
import {
  readJsonObject,
  TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES,
} from "../_shared/bounded-json.ts";
import { type AdminStats, formatStatsText, isAdminTelegramId, parseAdminIds } from "../_shared/admin-stats.ts";
import { groupCommandReply, groupCreateUrl, isGroupChatType, parseBotCommand } from "../_shared/group-chats.ts";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const appUrl = Deno.env.get("TELEGRAM_MINI_APP_URL") ?? "";
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = (Deno.env.get("TELEGRAM_DB_SECRET_KEY") ?? "").trim();
const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "flocklyappbot";
const appShortName = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "app";
const adminIds = parseAdminIds(Deno.env.get("TELEGRAM_ADMIN_IDS"));

const db = createAdminClient(supabaseUrl, serviceKey);

function telegramMessage(update: Record<string, unknown>) {
  const message = update.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const chat = (message as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return null;
  const chatId = (chat as Record<string, unknown>).id;
  if (typeof chatId !== "string" && typeof chatId !== "number") return null;
  const text = (message as Record<string, unknown>).text;
  const chatTitle = (chat as Record<string, unknown>).title;
  const from = (message as Record<string, unknown>).from;
  const sender = from && typeof from === "object" && !Array.isArray(from) ? from as Record<string, unknown> : null;
  return {
    // Anonymous group admins write as a bot; a link cannot be bound to them.
    senderId: sender && sender.is_bot !== true && typeof sender.id === "number" ? sender.id : null,
    chatId,
    chatType: (chat as Record<string, unknown>).type,
    chatTitle: typeof chatTitle === "string" ? chatTitle : "",
    text: typeof text === "string" ? text : "",
  };
}

// 4xx (no rights in the chat, the bot was removed) will not succeed on a
// webhook retry, so only 429/5xx are surfaced for Telegram to redeliver.
async function telegram(method: string, body: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return;
  if (response.status === 429 || response.status >= 500) throw new Error(`Telegram API ${method} failed`);
  console.warn("telegram_api_rejected", method, response.status);
}

async function handleGroupMessage(message: NonNullable<ReturnType<typeof telegramMessage>>) {
  const command = parseBotCommand(message.text, botUsername);
  if (!command) return;
  let createUrl: string | null = null;
  if (command === "/new" && message.senderId !== null) {
    if (!supabaseUrl || !serviceKey) throw new Error("Database access is not configured");
    const { data, error } = await db.rpc("create_group_link", {
      p_chat_id: Number(message.chatId),
      p_chat_title: message.chatTitle,
      p_issuer_telegram_user_id: message.senderId,
    });
    if (error || typeof data !== "string") throw new Error("create_group_link failed");
    createUrl = groupCreateUrl(botUsername, appShortName, data);
  }
  const reply = groupCommandReply(command, `https://t.me/${botUsername}/${appShortName}`, createUrl);
  if (reply) await telegram("sendMessage", { chat_id: message.chatId, ...reply });
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json(
      { error: "Метод не поддерживается." },
      405,
      { allow: "POST" },
    );
  try {
    if (!token || !appUrl || !webhookSecret) throw new Error("Telegram bot secrets are not configured");
    if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) return json({ error: "Unauthorized" }, 401);
    const update = await readJsonObject(request, TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES); const message = telegramMessage(update); if (!message) return json({ ok: true });
    if (isGroupChatType(message.chatType)) {
      await handleGroupMessage(message);
      return json({ ok: true });
    }
    if (message.chatType !== "private") return json({ ok: true });
    const command = message.text.split(/\s/)[0].split("@")[0];
    // Only administrators get /stats; for others it is an unknown command.
    if (command === "/stats" && isAdminTelegramId(message.senderId, adminIds) && supabaseUrl && serviceKey) {
      // A failed read is answered, not redelivered by Telegram.
      const { data, error } = await db.rpc("admin_stats");
      if (error) console.error("admin_stats_failed", error.code);
      const text = error ? "Не удалось получить статистику. Попробуйте позже." : formatStatsText(data as AdminStats);
      await telegram("sendMessage", { chat_id: message.chatId, text });
      return json({ ok: true });
    }
    const screens: Record<string, string> = { "/new": "create", "/my": "my-events" }; const screen = screens[command];
    const text = command === "/help" ? "Создайте встречу, отправьте её в чат и соберите ответы без регистрации." : command === "/new" ? "Создадим новую встречу." : command === "/my" ? "Ваши встречи доступны в Mini App." : "Откройте Flockly, чтобы организовать встречу.";
    await telegram("sendMessage", { chat_id: message.chatId, text, reply_markup: { inline_keyboard: [[{ text: command === "/new" ? "Создать встречу" : command === "/my" ? "Мои встречи" : "Открыть Flockly", web_app: { url: screen ? `${appUrl}?screen=${screen}` : appUrl } }]] } });
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
});
