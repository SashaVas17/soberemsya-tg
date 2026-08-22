import { safeApplicationErrorCode } from "./errors.ts";

const browserOrigins = new Set([
  "https://sashavas17.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const browserMethods = "GET, POST, PATCH, DELETE, OPTIONS";
const browserHeaders = "apikey, content-type, x-telegram-init-data";

export function browserCorsHeaders(origin: string | null) {
  if (!origin || !browserOrigins.has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": browserHeaders,
    "access-control-allow-methods": browserMethods,
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function browserPreflightResponse(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !browserCorsHeaders(origin))
    return json({ error: "Доступ запрещён." }, 403, { vary: "Origin" });
  return new Response(null, {
    status: 204,
    headers: browserCorsHeaders(origin) ?? undefined,
  });
}

export function withBrowserCors(request: Request, response: Response) {
  const origin = request.headers.get("origin");
  const cors = browserCorsHeaders(origin);
  if (!origin && !cors) return response;
  const headers = new Headers(response.headers);
  if (origin) headers.set("vary", "Origin");
  if (!cors)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

export function errorResponse(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const code = status < 500 ? safeApplicationErrorCode(error) : null;
  console.error(message);
  return json({ error: status >= 500 ? "Не удалось выполнить действие." : message, ...(code ? { code } : {}) }, status);
}
