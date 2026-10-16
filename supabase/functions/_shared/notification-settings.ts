export type ResponseMode = "summary" | "each" | "off";

export type NotificationSettings = {
  responseMode: ResponseMode;
  reminder24h: boolean;
  reminder2h: boolean;
  canMessage: boolean | null;
};

export type NotificationSettingsUpdate = {
  preferences: Partial<{ response_mode: ResponseMode; reminder_24h: boolean; reminder_2h: boolean }>;
  writeAccessGranted: boolean;
};

const responseModes = new Set<ResponseMode>(["summary", "each", "off"]);

function invalid(): never {
  throw Object.assign(new Error("Некорректные настройки уведомлений."), { status: 400 });
}

export function notificationSettingsResponse(
  preferences: { response_mode: string; reminder_24h: boolean; reminder_2h: boolean } | null,
  canMessage: boolean | null,
): NotificationSettings {
  const mode = preferences?.response_mode;
  return {
    responseMode: responseModes.has(mode as ResponseMode) ? (mode as ResponseMode) : "summary",
    reminder24h: preferences?.reminder_24h ?? true,
    reminder2h: preferences?.reminder_2h ?? true,
    canMessage,
  };
}

export function parseNotificationSettingsUpdate(payload: Record<string, unknown>): NotificationSettingsUpdate {
  const preferences: NotificationSettingsUpdate["preferences"] = {};
  if (payload.responseMode !== undefined) {
    if (!responseModes.has(payload.responseMode as ResponseMode)) invalid();
    preferences.response_mode = payload.responseMode as ResponseMode;
  }
  for (const [key, column] of [["reminder24h", "reminder_24h"], ["reminder2h", "reminder_2h"]] as const) {
    if (payload[key] === undefined) continue;
    if (typeof payload[key] !== "boolean") invalid();
    preferences[column] = payload[key] as boolean;
  }
  if (payload.writeAccessGranted !== undefined && typeof payload.writeAccessGranted !== "boolean") invalid();
  const writeAccessGranted = payload.writeAccessGranted === true;
  if (!Object.keys(preferences).length && !writeAccessGranted) invalid();
  return { preferences, writeAccessGranted };
}
