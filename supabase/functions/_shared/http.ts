import { safeApplicationErrorCode } from "./errors.ts";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-telegram-init-data, x-telegram-bot-api-secret-token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

export function errorResponse(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const code = status < 500 ? safeApplicationErrorCode(error) : null;
  console.error(message);
  return json({ error: status >= 500 ? "Не удалось выполнить действие." : message, ...(code ? { code } : {}) }, status);
}
