export type TelegramInitUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
  photo_url?: string;
};

export type ValidatedTelegramData = {
  user: TelegramInitUser;
  startParam: string | null;
  authDate: number;
};

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function hmac(key: BufferSource, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

export async function signTelegramInitData(
  params: URLSearchParams,
  botToken: string,
) {
  const pairs = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  return bytesToHex(await hmac(secret, dataCheckString));
}

export async function validateTelegramInitData(
  raw: string,
  botToken: string,
  options: { now?: number; maxAgeSeconds?: number } = {},
): Promise<ValidatedTelegramData> {
  if (!raw) throw new Error("Telegram initData is missing");
  if (!botToken) throw new Error("Telegram bot token is not configured");
  const params = new URLSearchParams(raw);
  const receivedHash = params.get("hash")?.toLowerCase() ?? "";
  if (!/^[a-f0-9]{64}$/.test(receivedHash))
    throw new Error("Invalid Telegram signature");
  const expectedHash = await signTelegramInitData(params, botToken);
  if (!timingSafeEqual(receivedHash, expectedHash))
    throw new Error("Invalid Telegram signature");
  const authDate = Number(params.get("auth_date"));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 3600;
  if (
    !Number.isInteger(authDate) ||
    authDate > now + 30 ||
    now - authDate > maxAge
  )
    throw new Error("Telegram authorization data has expired");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram user is missing");
  const user = JSON.parse(rawUser) as TelegramInitUser;
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || !user.first_name)
    throw new Error("Invalid Telegram user");
  return { user, startParam: params.get("start_param"), authDate };
}
