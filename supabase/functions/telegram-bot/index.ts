import { errorResponse, json } from "../_shared/http.ts";
import {
  readJsonObject,
  TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES,
} from "../_shared/bounded-json.ts";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const appUrl = Deno.env.get("TELEGRAM_MINI_APP_URL") ?? "";
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

function telegramMessage(update: Record<string, unknown>) {
  const message = update.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const chat = (message as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return null;
  const chatId = (chat as Record<string, unknown>).id;
  if (typeof chatId !== "string" && typeof chatId !== "number") return null;
  const text = (message as Record<string, unknown>).text;
  return { chatId, text: typeof text === "string" ? text : "" };
}

async function telegram(method: string, body: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Telegram API ${method} failed`);
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
    const command = message.text.split(/\s/)[0].split("@")[0];
    const screens: Record<string, string> = { "/new": "create", "/my": "my-events" }; const screen = screens[command];
    const text = command === "/help" ? "Создайте встречу, отправьте её в чат и соберите ответы без регистрации." : command === "/new" ? "Создадим новую встречу." : command === "/my" ? "Ваши встречи доступны в Mini App." : "Откройте «Соберёмся», чтобы организовать встречу.";
    await telegram("sendMessage", { chat_id: message.chatId, text, reply_markup: { inline_keyboard: [[{ text: command === "/new" ? "Создать встречу" : command === "/my" ? "Мои встречи" : "Открыть «Соберёмся»", web_app: { url: screen ? `${appUrl}?screen=${screen}` : appUrl } }]] } });
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
});
