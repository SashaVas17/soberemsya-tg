export const CREATE_REQUEST_KEY_STORAGE_KEY = "soberemsya-create-request";
export const CREATE_REQUEST_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateRequestKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredCreateRequestKey = {
  fingerprint: string;
  key: string;
  savedAt: number;
};

// Fallback when localStorage is unavailable: still covers retries until reload.
let memoryKey: StoredCreateRequestKey | null = null;

function browserStorage(): CreateRequestKeyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function newClientRequestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readStored(storage: CreateRequestKeyStorage): StoredCreateRequestKey | null {
  try {
    const raw = storage.getItem(CREATE_REQUEST_KEY_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredCreateRequestKey>;
    if (
      typeof value.fingerprint !== "string" ||
      typeof value.key !== "string" ||
      typeof value.savedAt !== "number"
    ) return null;
    return value as StoredCreateRequestKey;
  } catch {
    return null;
  }
}

/**
 * Returns the idempotency key for this exact create payload. A retry of the
 * same payload (after a lost response, a timeout or an app reload) reuses the
 * key, so the server returns the event it already created instead of a copy.
 * Any change to the payload produces a fresh key.
 */
export function createRequestKeyFor(
  payload: unknown,
  storage: CreateRequestKeyStorage | null = browserStorage(),
  now = Date.now(),
) {
  const fingerprint = JSON.stringify(payload);
  // The in-memory copy is the latest write; storage may be stale or read-only.
  const stored = memoryKey?.fingerprint === fingerprint
    ? memoryKey
    : storage ? readStored(storage) : null;
  if (
    stored &&
    stored.fingerprint === fingerprint &&
    now - stored.savedAt >= 0 &&
    now - stored.savedAt < CREATE_REQUEST_KEY_TTL_MS
  ) return stored.key;
  const key = newClientRequestId();
  memoryKey = { fingerprint, key, savedAt: now };
  try {
    storage?.setItem(CREATE_REQUEST_KEY_STORAGE_KEY, JSON.stringify(memoryKey));
  } catch {
    // The in-memory copy still covers retries until the app reloads.
  }
  return key;
}

export function clearCreateRequestKey(
  storage: CreateRequestKeyStorage | null = browserStorage(),
) {
  memoryKey = null;
  try {
    storage?.removeItem(CREATE_REQUEST_KEY_STORAGE_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
