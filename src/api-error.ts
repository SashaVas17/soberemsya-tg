export const SAFE_API_ERROR_CODES = [
  "PUBLIC_JOIN_REQUIRED",
  "PUBLIC_OWNER_CANNOT_RESPOND",
  "PUBLIC_PREVIEW_REQUIRED",
  "JOIN_REQUEST_NOT_ALLOWED",
  "JOIN_REQUESTS_CLOSED",
  "JOIN_REQUEST_NOT_PENDING",
  "NOT_EVENT_OWNER",
  "OWNER_CANNOT_JOIN",
  "JOIN_REQUEST_REJECTED",
  "EVENT_FULL",
] as const;

export type ApiErrorCode = (typeof SAFE_API_ERROR_CODES)[number];

const safeApiErrorCodes = new Set<string>(SAFE_API_ERROR_CODES);

export class ApiError extends Error {
  readonly status: number;
  readonly code?: ApiErrorCode;

  constructor(message: string, status: number, code?: ApiErrorCode) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiErrorFromBody(status: number, body: unknown) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message =
    typeof record.error === "string"
      ? record.error
      : "Не удалось выполнить действие.";
  const rawCode = typeof record.code === "string" ? record.code : "";
  const code = safeApiErrorCodes.has(rawCode)
    ? rawCode as ApiErrorCode
    : undefined;
  return new ApiError(message, status, code);
}

export function hasApiErrorCode(
  error: unknown,
  code: ApiErrorCode,
): error is ApiError {
  return error instanceof ApiError && error.code === code;
}
