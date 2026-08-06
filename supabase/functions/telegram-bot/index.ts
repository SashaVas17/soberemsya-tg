import { corsHeaders, errorResponse, json } from "../_shared/http.ts";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const appUrl = Deno.env.get("TELEGRAM_MINI_APP_URL") ?? "";
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

async function telegram(method: string, body: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Telegram API ${method} failed`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!token || !appUrl || !webhookSecret) throw new Error("Telegram bot secrets are not configured");
    if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) return json({ error: "Unauthorized" }, 401);
    const update = await request.json(); const message = update.message; if (!message?.chat?.id) return json({ ok: true });
    const command = String(message.text ?? "").split(/\s/)[0].split("@")[0];
    const screens: Record<string, string> = { "/new": "create", "/my": "my-events" }; const screen = screens[command];
    const text = command === "/help" ? "Создайте встречу, отправьте её в чат и соберите ответы без регистрации." : command === "/new" ? "Создадим новую встречу." : command === "/my" ? "Ваши встречи доступны в Mini App." : "Откройте «Соберёмся», чтобы организовать встречу.";
    await telegram("sendMessage", { chat_id: message.chat.id, text, reply_markup: { inline_keyboard: [[{ text: command === "/new" ? "Создать встречу" : command === "/my" ? "Мои встречи" : "Открыть «Соберёмся»", web_app: { url: screen ? `${appUrl}?screen=${screen}` : appUrl } }]] } });
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
});
