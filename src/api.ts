import type { AuthResult, EventData, MeetingListItem } from "./types";
import { mockApi } from "./mock-api";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const functionUrl =
  import.meta.env.VITE_SERVER_FUNCTION_URL?.replace(/\/$/, "") ||
  `${supabaseUrl}/functions/v1/telegram-api`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const useMock = import.meta.env.VITE_USE_MOCK_API === "true";

let initData = "";

export function setInitData(value: string) {
  initData = value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!functionUrl || !publishableKey)
    throw new Error("Сервер приложения не настроен.");
  const response = await fetch(`${functionUrl}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      "x-telegram-init-data": initData,
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "Не удалось выполнить действие.");
  return body as T;
}

export const api = {
  auth: (rawInitData: string) => {
    setInitData(rawInitData);
    return useMock
      ? mockApi.auth()
      : request<AuthResult>("/telegram/auth", {
          method: "POST",
          body: JSON.stringify({ initData: rawInitData }),
        });
  },
  event: (id: string) =>
    useMock
      ? mockApi.event()
      : request<{ event: EventData }>(`/events/${encodeURIComponent(id)}`),
  createEvent: (payload: unknown) =>
    useMock
      ? mockApi.createEvent(payload)
      : request<{ event: EventData }>("/events", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
  saveResponse: (id: string, payload: unknown) =>
    useMock
      ? mockApi.saveResponse(id, payload)
      : request<{ event: EventData }>(
          `/events/${encodeURIComponent(id)}/response`,
          { method: "POST", body: JSON.stringify(payload) },
        ),
  meetings: () =>
    useMock
      ? mockApi.meetings()
      : request<{ owned: MeetingListItem[]; participating: MeetingListItem[] }>(
          "/me/meetings",
        ),
  manage: (id: string, payload: unknown) =>
    useMock
      ? mockApi.manage(id, payload)
      : request<{ event: EventData }>(
          `/events/${encodeURIComponent(id)}/manage`,
          { method: "PATCH", body: JSON.stringify(payload) },
        ),
  remove: (id: string) =>
    useMock
      ? mockApi.remove()
      : request<{ deleted: true }>(`/events/${encodeURIComponent(id)}/manage`, {
          method: "DELETE",
        }),
  calendarLink: (id: string) =>
    useMock
      ? Promise.resolve({ icsUrl: "https://example.test/soberemsya.ics" })
      : request<{ icsUrl: string }>(
          `/events/${encodeURIComponent(id)}/calendar-link`,
          { method: "POST" },
        ),
};
