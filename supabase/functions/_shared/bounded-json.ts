export const TELEGRAM_AUTH_BODY_LIMIT_BYTES = 8 * 1024;
export const API_JSON_BODY_LIMIT_BYTES = 32 * 1024;
export const TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

export class RequestBodyError extends Error {
  constructor(
    public readonly code: "REQUEST_BODY_TOO_LARGE" | "INVALID_JSON",
    public readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

function invalidJsonError() {
  return new RequestBodyError(
    "INVALID_JSON",
    400,
    "Некорректный JSON-запрос.",
  );
}

function bodyTooLargeError() {
  return new RequestBodyError(
    "REQUEST_BODY_TOO_LARGE",
    413,
    "Размер запроса слишком большой.",
  );
}

function declaredContentLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function joinChunks(chunks: Uint8Array[], length: number) {
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const contentLength = declaredContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) throw bodyTooLargeError();

  if (!request.body) throw invalidJsonError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw bodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      joinChunks(chunks, total),
    );
    if (!text.trim()) throw new SyntaxError();
    parsed = JSON.parse(text);
  } catch {
    throw invalidJsonError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw invalidJsonError();
  return parsed as Record<string, unknown>;
}
