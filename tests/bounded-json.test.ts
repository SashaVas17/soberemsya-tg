import { describe, expect, it } from "vitest";
import {
  readJsonObject,
  RequestBodyError,
} from "../supabase/functions/_shared/bounded-json.ts";

function requestFromChunks(chunks: Uint8Array[], headers?: HeadersInit) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("https://example.test", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit);
}

async function requestBodyError(request: Request, limit: number) {
  try {
    await readJsonObject(request, limit);
  } catch (error) {
    return error as RequestBodyError;
  }
  throw new Error("Expected bounded JSON reader to reject.");
}

describe("bounded JSON reader", () => {
  it("parses a body below or exactly at the byte limit", async () => {
    const body = JSON.stringify({ title: "Встреча" });
    const bytes = new TextEncoder().encode(body);
    await expect(readJsonObject(requestFromChunks([bytes]), bytes.byteLength + 1))
      .resolves.toEqual({ title: "Встреча" });
    await expect(readJsonObject(requestFromChunks([bytes]), bytes.byteLength))
      .resolves.toEqual({ title: "Встреча" });
  });

  it("rejects a byte above the limit, even when Content-Length is absent or low", async () => {
    const bytes = new TextEncoder().encode('{"title":"12345"}');
    expect((await requestBodyError(requestFromChunks([bytes]), bytes.byteLength - 1)).code)
      .toBe("REQUEST_BODY_TOO_LARGE");
    expect((await requestBodyError(
      requestFromChunks([bytes], { "content-length": "1" }),
      bytes.byteLength - 1,
    )).status).toBe(413);
  });

  it("uses a valid oversized Content-Length as an early rejection", async () => {
    const request = requestFromChunks([], { "content-length": "1025" });
    const error = await requestBodyError(request, 1024);
    expect(error.code).toBe("REQUEST_BODY_TOO_LARGE");
    expect(error.message).not.toContain("1025");
  });

  it("does not trust malformed Content-Length over streamed bytes", async () => {
    const bytes = new TextEncoder().encode('{"title":"12345"}');
    const error = await requestBodyError(
      requestFromChunks([bytes], { "content-length": "not-a-number" }),
      bytes.byteLength - 1,
    );
    expect(error.code).toBe("REQUEST_BODY_TOO_LARGE");
  });

  it("returns safe invalid-json errors for malformed, empty, and non-object JSON", async () => {
    for (const body of ["{", "", "[]", "1"]) {
      const error = await requestBodyError(
        requestFromChunks([new TextEncoder().encode(body)]),
        100,
      );
      expect(error.code).toBe("INVALID_JSON");
      expect(error.status).toBe(400);
      if (body) expect(error.message).not.toContain(body);
    }
  });

  it("counts Cyrillic by UTF-8 bytes rather than characters", async () => {
    const body = JSON.stringify({ description: "Привет" });
    const bytes = new TextEncoder().encode(body);
    expect(bytes.byteLength).toBeGreaterThan(body.length);
    await expect(readJsonObject(requestFromChunks([bytes]), bytes.byteLength))
      .resolves.toEqual({ description: "Привет" });
  });
});
