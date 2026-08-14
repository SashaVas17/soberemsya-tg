export const SAFE_APPLICATION_ERROR_CODES = [
  "PUBLIC_JOIN_REQUIRED",
  "PUBLIC_OWNER_CANNOT_RESPOND",
] as const;

export type SafeApplicationErrorCode =
  (typeof SAFE_APPLICATION_ERROR_CODES)[number];

const safeApplicationErrorCodes = new Set<string>(
  SAFE_APPLICATION_ERROR_CODES,
);

export function applicationError(
  code: SafeApplicationErrorCode,
  status: number,
  message: string,
) {
  return Object.assign(new Error(message), { code, status });
}

export function safeApplicationErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = String(error.code);
  return safeApplicationErrorCodes.has(code)
    ? (code as SafeApplicationErrorCode)
    : null;
}
