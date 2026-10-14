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

function declaredContentLength(headers: Headers) {
  const value = headers.get("content-length");
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

/** Reads a request or response body, failing once it grows past maxBytes. */
export async function readBoundedBytes(
  message: Request | Response,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<Uint8Array> {
  const contentLength = declaredContentLength(message.headers);
  if (contentLength !== null && contentLength > maxBytes) {
    await message.body?.cancel();
    throw tooLarge();
  }
  if (!message.body) return new Uint8Array(0);
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return joinChunks(chunks, total);
}

export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  // A missing body reads as empty and fails as invalid JSON below.
  const body = await readBoundedBytes(request, maxBytes, bodyTooLargeError);

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (!text.trim()) throw new SyntaxError();
    parsed = JSON.parse(text);
  } catch {
    throw invalidJsonError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw invalidJsonError();
  return parsed as Record<string, unknown>;
}
