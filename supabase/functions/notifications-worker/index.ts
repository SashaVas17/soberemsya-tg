import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { json } from "../_shared/http.ts";
import {
  classifyTelegramResult,
  eventDeepLink,
  isNotificationStale,
  type NotificationKind,
  renderNotification,
  type TelegramSendOutcome,
} from "../_shared/notification-messages.ts";

type ClaimedNotification = {
  id: number;
  telegram_user_id: number;
  kind: NotificationKind;
  event_id: string | null;
  event_status: string | null;
  event_deleted: boolean;
  payload: Record<string, unknown>;
  attempts: number;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = (Deno.env.get("TELEGRAM_DB_SECRET_KEY") ?? "").trim();
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const bot = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "soberemsyabelarusbot";
const app = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "soberemsya";
const BATCH_SIZE = 25;
const MAX_BATCHES = 4;

// New-format secret keys must reach the REST API only in the apikey header.
const adminFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("apikey", serviceKey);
  headers.delete("Authorization");
  return fetch(input, { ...init, headers });
};
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: adminFetch },
});

async function sendMessage(item: ClaimedNotification): Promise<TelegramSendOutcome> {
  const message = renderNotification(item.kind, item.payload ?? {}, eventDeepLink(bot, app, item.event_id));
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: item.telegram_user_id,
        text: message.text,
        reply_markup: { inline_keyboard: [[{ text: message.buttonText, url: message.url }]] },
      }),
    });
    const body = await response.json().catch(() => null);
    return classifyTelegramResult(response.status, body);
  } catch (error) {
    return { outcome: "retry", error: error instanceof Error ? error.message : "network error" };
  }
}

async function complete(id: number, outcome: string, error?: string, retryAfterSeconds?: number) {
  const { error: rpcError } = await db.rpc("complete_notification", {
    p_id: id,
    p_outcome: outcome,
    p_error: error ?? null,
    p_retry_after_seconds: retryAfterSeconds ?? null,
  });
  if (rpcError) console.error("complete_notification_failed", rpcError.code);
}

async function processBatch() {
  const { data, error } = await db.rpc("claim_notification_batch", { p_limit: BATCH_SIZE });
  if (error) throw error;
  const items = (data ?? []) as ClaimedNotification[];
  let throttledFor: number | null = null;
  for (const item of items) {
    if (throttledFor !== null) {
      await complete(item.id, "retry", "throttled", throttledFor);
      continue;
    }
    if (isNotificationStale(item.kind, item.event_status, item.event_deleted)) {
      await complete(item.id, "skip", "meeting cancelled or deleted");
      continue;
    }
    const result = await sendMessage(item);
    if (result.outcome === "sent") await complete(item.id, "sent");
    else if (result.outcome === "retry") {
      await complete(item.id, "retry", result.error, result.retryAfterSeconds);
      if (result.retryAfterSeconds) throttledFor = result.retryAfterSeconds;
    } else await complete(item.id, result.outcome, result.error);
  }
  return items.length;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  if (!supabaseUrl || !serviceKey || !botToken) return json({ error: "Not configured" }, 500);
  const secret = request.headers.get("x-worker-secret") ?? "";
  const { data: valid, error } = await db.rpc("verify_notifications_worker_secret", { p_secret: secret });
  if (error) {
    console.error("worker_secret_check_failed", error.code);
    return json({ error: "Unavailable" }, 503);
  }
  if (valid !== true) return json({ error: "Unauthorized" }, 401);
  let processed = 0;
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const count = await processBatch();
      processed += count;
      if (count < BATCH_SIZE) break;
    }
  } catch (failure) {
    console.error("notifications_worker_failed", failure instanceof Error ? failure.message : "unknown");
    return json({ processed, error: "partial failure" }, 500);
  }
  return json({ processed });
});
