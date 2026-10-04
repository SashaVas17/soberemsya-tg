import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api-error";
import {
  CREATE_REQUEST_KEY_STORAGE_KEY,
  CREATE_REQUEST_KEY_TTL_MS,
  clearCreateRequestKey,
  createRequestKeyFor,
  newClientRequestId,
  type CreateRequestKeyStorage,
} from "../src/create-request-key";
import {
  CREATE_EVENT_NETWORK_ERROR,
  createEventErrorMessage,
  submitCreateEventOnce,
  type CreateEventRequest,
  type CreateWizardDraft,
} from "../src/create-wizard";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memoryStorage(): CreateRequestKeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const draft: CreateWizardDraft = {
  title: "Шашлыки",
  description: "",
  budgetLimit: 30,
  visibility: "private",
  maxParticipants: null,
  timeOptions: ["2026-10-15T16:00:00.000Z"],
  places: [],
};

beforeEach(() => clearCreateRequestKey(null));

describe("create request key", () => {
  it("generates RFC 4122 v4 ids", () => {
    expect(newClientRequestId()).toMatch(uuidPattern);
    expect(newClientRequestId()).not.toBe(newClientRequestId());
  });

  it("reuses the key for the same payload and replaces it when the payload changes", () => {
    const storage = memoryStorage();
    const first = createRequestKeyFor({ title: "A" }, storage, 1_000);
    expect(createRequestKeyFor({ title: "A" }, storage, 2_000)).toBe(first);
    const changed = createRequestKeyFor({ title: "B" }, storage, 3_000);
    expect(changed).not.toBe(first);
    expect(createRequestKeyFor({ title: "A" }, storage, 4_000)).not.toBe(first);
  });

  it("survives a reload through storage and expires after the TTL", () => {
    const storage = memoryStorage();
    const key = createRequestKeyFor({ title: "A" }, storage, 0);
    clearCreateRequestKey(null);
    expect(createRequestKeyFor({ title: "A" }, storage, CREATE_REQUEST_KEY_TTL_MS - 1)).toBe(key);
    expect(createRequestKeyFor({ title: "A" }, storage, CREATE_REQUEST_KEY_TTL_MS + 1)).not.toBe(key);
  });

  it("falls back to memory when storage is missing or throws", () => {
    const key = createRequestKeyFor({ title: "A" }, null, 0);
    expect(createRequestKeyFor({ title: "A" }, null, 1)).toBe(key);
    const broken: CreateRequestKeyStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const brokenKey = createRequestKeyFor({ title: "B" }, broken, 0);
    expect(createRequestKeyFor({ title: "B" }, broken, 1)).toBe(brokenKey);
    expect(() => clearCreateRequestKey(broken)).not.toThrow();
  });

  it("prefers the in-memory key when storage is read-only and holds an older entry", () => {
    const stale = memoryStorage();
    stale.data.set(CREATE_REQUEST_KEY_STORAGE_KEY, JSON.stringify({ fingerprint: "{\"old\":1}", key: "old", savedAt: 0 }));
    const readOnly: CreateRequestKeyStorage = {
      getItem: stale.getItem,
      setItem: () => { throw new Error("quota"); },
      removeItem: stale.removeItem,
    };
    const key = createRequestKeyFor({ title: "A" }, readOnly, 1);
    expect(createRequestKeyFor({ title: "A" }, readOnly, 2)).toBe(key);
  });

  it("ignores corrupted stored values", () => {
    const storage = memoryStorage();
    storage.data.set(CREATE_REQUEST_KEY_STORAGE_KEY, "{not json");
    expect(createRequestKeyFor({ title: "A" }, storage, 0)).toMatch(uuidPattern);
  });
});

describe("submitCreateEventOnce idempotency", () => {
  it("sends the same key on a retry after a network failure, then clears it on success", async () => {
    const storage = memoryStorage();
    const sent: CreateEventRequest[] = [];
    const failing = vi.fn(async (payload: CreateEventRequest) => {
      sent.push(payload);
      throw new TypeError("Failed to fetch");
    });
    await expect(submitCreateEventOnce(draft, { current: false }, failing, storage))
      .rejects.toThrow(TypeError);
    const succeeding = vi.fn(async (payload: CreateEventRequest) => {
      sent.push(payload);
      return { event: { id: "evt_1" } };
    });
    await submitCreateEventOnce(draft, { current: false }, succeeding, storage);
    expect(sent).toHaveLength(2);
    expect(sent[0].clientRequestId).toMatch(uuidPattern);
    expect(sent[1].clientRequestId).toBe(sent[0].clientRequestId);
    expect(storage.data.has(CREATE_REQUEST_KEY_STORAGE_KEY)).toBe(false);
  });

  it("keeps the key after a 5xx and drops it after a 4xx", async () => {
    const storage = memoryStorage();
    const serverError = async () => { throw new ApiError("boom", 503); };
    await expect(submitCreateEventOnce(draft, { current: false }, serverError, storage)).rejects.toThrow();
    expect(storage.data.has(CREATE_REQUEST_KEY_STORAGE_KEY)).toBe(true);
    const conflict = async () => { throw new ApiError("conflict", 409); };
    await expect(submitCreateEventOnce(draft, { current: false }, conflict, storage)).rejects.toThrow();
    expect(storage.data.has(CREATE_REQUEST_KEY_STORAGE_KEY)).toBe(false);
  });

  it("keeps the key when a successful response has no event (body lost)", async () => {
    const storage = memoryStorage();
    const empty = async () => ({}) as { event: { id: string } };
    await expect(submitCreateEventOnce(draft, { current: false }, empty, storage))
      .rejects.toThrow(SyntaxError);
    expect(storage.data.has(CREATE_REQUEST_KEY_STORAGE_KEY)).toBe(true);
  });

  it("uses a new key for a second, deliberate creation of the same meeting", async () => {
    const storage = memoryStorage();
    const keys: string[] = [];
    const create = async (payload: CreateEventRequest) => {
      keys.push(payload.clientRequestId);
      return { event: { id: `evt_${keys.length}` } };
    };
    await submitCreateEventOnce(draft, { current: false }, create, storage);
    await submitCreateEventOnce(draft, { current: false }, create, storage);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe("create error messages", () => {
  it("explains that retrying after a network failure is safe", () => {
    expect(createEventErrorMessage(new TypeError("Failed to fetch"))).toBe(CREATE_EVENT_NETWORK_ERROR);
    expect(createEventErrorMessage(new DOMException("Timed out", "TimeoutError"))).toBe(CREATE_EVENT_NETWORK_ERROR);
    expect(createEventErrorMessage(new DOMException("Aborted", "AbortError"))).toBe(CREATE_EVENT_NETWORK_ERROR);
    expect(createEventErrorMessage(new SyntaxError("Unexpected end of JSON"))).toBe(CREATE_EVENT_NETWORK_ERROR);
    expect(createEventErrorMessage(new ApiError("Укажите название встречи.", 400))).toBe("Укажите название встречи.");
  });

  it("maps only submission errors, not errors after a successful create", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const submit = app.slice(app.indexOf("const submit = useCallback"), app.indexOf("return (\n    <main className=\"create-screen\">"));
    const catchBlock = submit.indexOf("setError(createEventErrorMessage(reason));");
    expect(catchBlock).toBeGreaterThan(-1);
    expect(submit.indexOf("onCreated(result.event);")).toBeGreaterThan(submit.indexOf("} finally {"));
  });

  it("bounds the create request with a timeout", () => {
    const api = readFileSync("src/api.ts", "utf8");
    const create = api.slice(api.indexOf("createEvent:"), api.indexOf("saveResponse:"));
    expect(create).toContain("signal: timeoutSignal(CREATE_EVENT_TIMEOUT_MS)");
  });
});
