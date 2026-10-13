import { createAdminClient } from "../_shared/admin-client.ts";
import { json } from "../_shared/http.ts";
import { type GroupMessageKind, isGroupMessageStale, renderGroupMessage } from "../_shared/group-chats.ts";
import {
  classifyTelegramResult,
  eventDeepLink,
  isNotificationStale,
  notificationLink,
  type NotificationKind,
  type NotificationMessage,
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

type ClaimedGroupMessage = {
  id: number;
  chat_id: number;
  kind: GroupMessageKind;
  event_id: string;
  event_status: string | null;
  event_deleted: boolean;
  payload: Record<string, unknown>;
  attempts: number;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = (Deno.env.get("TELEGRAM_DB_SECRET_KEY") ?? "").trim();
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const bot = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "flocklyappbot";
const app = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "app";
const BATCH_SIZE = 25;
const MAX_BATCHES = 4;

const db = createAdminClient(supabaseUrl, serviceKey);

async function sendMessage(chatId: number, message: NotificationMessage): Promise<TelegramSendOutcome> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
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

async function processPersonalBatch() {
  const { data, error } = await db.rpc("claim_notification_batch", { p_limit: BATCH_SIZE });
  if (error) throw error;
  const items = (data ?? []) as ClaimedNotification[];
  let throttledFor: number | null = null;
  for (const item of items) {
    if (throttledFor !== null) {
      await complete(item.id, "defer", "throttled", throttledFor);
      continue;
    }
    if (isNotificationStale(item.kind, item.event_status, item.event_deleted)) {
      await complete(item.id, "skip", "meeting cancelled or deleted");
      continue;
    }
    const result = await sendMessage(
      item.telegram_user_id,
      renderNotification(item.kind, item.payload ?? {}, notificationLink(bot, app, item.kind, item.event_id)),
    );
    if (result.outcome === "sent") await complete(item.id, "sent");
    else if (result.outcome === "retry") {
      await complete(item.id, "retry", result.error, result.retryAfterSeconds);
      if (result.retryAfterSeconds) throttledFor = result.retryAfterSeconds;
    } else await complete(item.id, result.outcome, result.error);
  }
  return items.length;
}

async function completeGroup(id: number, outcome: string, error?: string, retryAfterSeconds?: number, newChatId?: number) {
  const { error: rpcError } = await db.rpc("complete_group_message", {
    p_id: id,
    p_outcome: outcome,
    p_error: error ?? null,
    p_retry_after_seconds: retryAfterSeconds ?? null,
    p_new_chat_id: newChatId ?? null,
  });
  if (rpcError) console.error("complete_group_message_failed", rpcError.code);
}

// Group chats get only the meeting card and the final result.
async function processGroupBatch() {
  const { data, error } = await db.rpc("claim_group_message_batch", { p_limit: BATCH_SIZE });
  if (error) throw error;
  const items = (data ?? []) as ClaimedGroupMessage[];
  let throttledFor: number | null = null;
  for (const item of items) {
    if (throttledFor !== null) {
      await completeGroup(item.id, "defer", "throttled", throttledFor);
      continue;
    }
    if (isGroupMessageStale(item.kind, item.event_status, item.event_deleted)) {
      await completeGroup(item.id, "skip", "meeting cancelled, reopened or deleted");
      continue;
    }
    const result = await sendMessage(
      item.chat_id,
      renderGroupMessage(item.kind, item.payload ?? {}, eventDeepLink(bot, app, item.event_id)),
    );
    if (result.outcome === "sent") await completeGroup(item.id, "sent");
    else if (result.outcome === "retry") {
      await completeGroup(item.id, "retry", result.error, result.retryAfterSeconds);
      if (result.retryAfterSeconds) throttledFor = result.retryAfterSeconds;
    } else if (result.outcome === "migrated")
      await completeGroup(item.id, "migrated", result.error, undefined, result.newChatId);
    else await completeGroup(item.id, result.outcome, result.error);
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
  // Personal and group deliveries run independently: a failure in one does
  // not hold back the other.
  let processed = 0;
  let failed = false;
  for (const [label, processBatch] of [["personal", processPersonalBatch], ["group", processGroupBatch]] as const) {
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const count = await processBatch();
        processed += count;
        if (count < BATCH_SIZE) break;
      }
    } catch (failure) {
      failed = true;
      console.error("notifications_worker_failed", label, failure instanceof Error ? failure.message : "unknown");
    }
  }
  if (failed) return json({ processed, error: "partial failure" }, 500);
  return json({ processed });
});
