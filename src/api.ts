import { apiErrorFromBody } from "./api-error";
import type { CreateEventRequest } from "./create-wizard";
import { isSessionExpiredError, notifySessionExpired } from "./session";
import type { AdminCity, AdminReport, AdminStats, AuthResult, BlockedUser, ReportStatus, EventData, NotificationSettings, JoinRequestActionResponse, JoinRequestDecisionResponse, MeetingListItem, OrganizerJoinRequestsResponse, PlaceOption, MeetingCategory, PublicEventPreview, PublicMeetingFeedPage, UserCity, AdminVenuePage, VenueDraft, VenueImportResult, VenuePage, VenuePriceLevel, VenueStatus, MapPoints, Venue } from "./types";
import { publicFeedPath, type PublicFeedFilters } from "./public-feed";
import { mockApi } from "./mock-api";
import { adminVenuesPath, venuesPath, type VenueFilters } from "./venues";
import { moderationTargetBody, type ModerationTarget, type ReportReason } from "./moderation";
import { language, t, type Language } from "./i18n";

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

export const CREATE_EVENT_TIMEOUT_MS = 25_000;

function timeoutSignal(ms: number) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return controller.signal;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!functionUrl || !publishableKey)
    throw new Error(t("Сервер приложения не настроен."));
  const response = await fetch(`${functionUrl}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      "x-telegram-init-data": initData,
      // Dates and cards the server writes follow the app's language.
      "x-flockly-language": language(),
      ...init?.headers,
    },
  });
  // A failed body read on success must reach the caller: for POST /events it
  // means the event may exist, so the client has to keep its retry key.
  if (response.ok) return (await response.json()) as T;
  const body = await response.json().catch(() => ({}));
  const error = apiErrorFromBody(response.status, body);
  if (isSessionExpiredError(error)) notifySessionExpired();
  throw error;
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
  /** The language for the bot and notifications; null — «as in Telegram». */
  saveLanguage: (value: Language | null) =>
    useMock
      ? mockApi.saveLanguage(value)
      : request<{ language: Language | null }>("/me/language", {
          method: "PUT",
          body: JSON.stringify({ language: value }),
        }),
  event: (id: string) =>
    useMock
      ? mockApi.event(id)
      : request<{ event: EventData }>(`/events/${encodeURIComponent(id)}`),
  publicEventPreview: (id: string) =>
    useMock
      ? mockApi.publicEventPreview(id)
      : request<{ preview: PublicEventPreview }>(
        `/events/${encodeURIComponent(id)}/preview`,
        ),
  publicMeetings: (cursor?: string, filters?: PublicFeedFilters) =>
    useMock
      ? mockApi.publicMeetings(cursor, filters)
      : request<PublicMeetingFeedPage>(publicFeedPath(cursor, filters)),
  categories: () =>
    useMock
      ? mockApi.categories()
      : request<{ categories: MeetingCategory[] }>("/categories"),
  createJoinRequest: (id: string) =>
    useMock
      ? mockApi.createJoinRequest(id)
      : request<JoinRequestActionResponse>(
          `/events/${encodeURIComponent(id)}/join-request`,
          { method: "POST", body: "{}" },
        ),
  joinRequests: (eventId: string) =>
    useMock
      ? mockApi.joinRequests(eventId)
      : request<OrganizerJoinRequestsResponse>(
          `/events/${encodeURIComponent(eventId)}/join-requests`,
        ),
  approveJoinRequest: (eventId: string, requestId: string) =>
    useMock
      ? mockApi.approveJoinRequest(eventId, requestId)
      : request<JoinRequestDecisionResponse>(
          `/events/${encodeURIComponent(eventId)}/join-requests/${encodeURIComponent(requestId)}/approve`,
          { method: "POST" },
        ),
  rejectJoinRequest: (eventId: string, requestId: string) =>
    useMock
      ? mockApi.rejectJoinRequest(eventId, requestId)
      : request<JoinRequestDecisionResponse>(
          `/events/${encodeURIComponent(eventId)}/join-requests/${encodeURIComponent(requestId)}/reject`,
          { method: "POST" },
        ),
  createEvent: (payload: CreateEventRequest & { groupToken?: string }) =>
    useMock
      ? mockApi.createEvent(payload)
      : request<{ event: EventData; groupAttached?: boolean }>("/events", {
          method: "POST",
          body: JSON.stringify(payload),
          signal: timeoutSignal(CREATE_EVENT_TIMEOUT_MS),
        }),
  saveResponse: (id: string, payload: unknown) =>
    useMock
      ? mockApi.saveResponse(id, payload)
      : request<{ event: EventData }>(
          `/events/${encodeURIComponent(id)}/response`,
          { method: "POST", body: JSON.stringify(payload) },
        ),
  proposeTimeOption: (id: string, startsAt: string) =>
    useMock
      ? mockApi.proposeTimeOption(id, startsAt)
      : request<{ event: EventData }>(
          `/events/${encodeURIComponent(id)}/time-options/proposals`,
          { method: "POST", body: JSON.stringify({ startsAt }) },
        ),
  proposePlaceOption: (
    id: string,
    place: Pick<PlaceOption, "title" | "area" | "estimatedBudget">,
  ) =>
    useMock
      ? mockApi.proposePlaceOption(id, place)
      : request<{ event: EventData }>(
          `/events/${encodeURIComponent(id)}/place-options/proposals`,
          { method: "POST", body: JSON.stringify({ place }) },
        ),
  leaveParticipation: (id: string) =>
    useMock
      ? mockApi.leaveParticipation(id)
      : request<{ left: true }>(
          `/events/${encodeURIComponent(id)}/participation`,
          { method: "DELETE" },
        ),
  removeParticipant: (eventId: string, participantId: string) =>
    useMock
      ? mockApi.removeParticipant(eventId, participantId)
      : request<{ removed: true }>(
          `/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`,
          { method: "DELETE" },
        ),
  meetings: () =>
    useMock
      ? mockApi.meetings()
      : request<{ owned: MeetingListItem[]; participating: MeetingListItem[] }>(
          "/me/meetings",
        ),
  meetingsPage: (role: MeetingListItem["role"], cursor?: string) =>
    useMock
      ? mockApi.meetingsPage(role, cursor)
      : request<{ items: MeetingListItem[]; nextCursor: string | null }>(
          `/me/meetings/page?role=${encodeURIComponent(role)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
  userCity: (cityId?: string) =>
    useMock
      ? mockApi.userCity(cityId)
      : request<UserCity>("/me/city", cityId
        ? { method: "PUT", body: JSON.stringify({ cityId }) }
        : undefined),
  notificationSettings: (
    update?: Partial<Omit<NotificationSettings, "canMessage">> & { writeAccessGranted?: boolean },
  ) =>
    useMock
      ? mockApi.notificationSettings(update)
      : request<NotificationSettings>("/me/notification-settings", update
        ? { method: "PUT", body: JSON.stringify(update) }
        : undefined),
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
  prepareShareMessage: (id: string, kind: "invite" | "result") =>
    useMock
      ? mockApi.prepareShareMessage()
      : request<{ preparedMessageId: string }>(
          `/events/${encodeURIComponent(id)}/share-message`,
          { method: "POST", body: JSON.stringify({ kind }) },
        ),
  adminStats: () =>
    useMock ? mockApi.adminStats() : request<{ stats: AdminStats }>("/admin/stats"),
  trackEvent: (name: "share_sent" | "share_fallback", eventId: string) =>
    useMock
      ? mockApi.trackEvent()
      : request<{ ok: true }>("/me/analytics", { method: "POST", body: JSON.stringify({ name, eventId }) }),
  groupLink: (token: string) =>
    useMock
      ? mockApi.groupLink()
      : request<{ groupLink: { chatTitle: string } }>(`/group-links/${encodeURIComponent(token)}`),
  reportEvent: (
    eventId: string,
    target: ModerationTarget,
    report: { reason: ReportReason; comment: string },
  ) =>
    useMock
      ? mockApi.reportEvent()
      : request<{ reported: true; alreadyReported: boolean }>(
          `/events/${encodeURIComponent(eventId)}/report`,
          { method: "POST", body: JSON.stringify({ ...report, ...moderationTargetBody(target) }) },
        ),
  blockFromEvent: (eventId: string, target: ModerationTarget) =>
    useMock
      ? mockApi.blockFromEvent(target)
      : request<{ blocked: true }>(
          `/events/${encodeURIComponent(eventId)}/block`,
          { method: "POST", body: JSON.stringify(moderationTargetBody(target)) },
        ),
  blockedUsers: () =>
    useMock ? mockApi.blockedUsers() : request<{ users: BlockedUser[] }>("/me/blocks"),
  unblockUser: (userId: string) =>
    useMock
      ? mockApi.unblockUser(userId)
      : request<{ unblocked: true }>(`/me/blocks/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  acceptCommunityRules: () =>
    useMock
      ? mockApi.acceptCommunityRules()
      : request<{ communityRulesAccepted: true }>("/me/community-rules", { method: "POST", body: "{}" }),
  adminReports: (status: ReportStatus = "open") =>
    useMock
      ? mockApi.adminReports(status)
      : request<{ reports: AdminReport[] }>(`/admin/reports?status=${encodeURIComponent(status)}`),
  adminResolveReport: (reportId: string, action: "resolve" | "dismiss") =>
    useMock
      ? mockApi.adminResolveReport(reportId, action)
      : request<{ status: ReportStatus }>(
          `/admin/reports/${encodeURIComponent(reportId)}/${action}`,
          { method: "POST", body: "{}" },
        ),
  adminSetEventHidden: (eventId: string, hidden: boolean) =>
    useMock
      ? mockApi.adminSetEventHidden(eventId, hidden)
      : request<{ hidden: boolean }>(
          `/admin/events/${encodeURIComponent(eventId)}/${hidden ? "hide" : "unhide"}`,
          { method: "POST", body: "{}" },
        ),
  adminSetUserBanned: (userId: string, banned: boolean) =>
    useMock
      ? mockApi.adminSetUserBanned(userId, banned)
      : request<{ banned: boolean; hiddenEvents: number }>(
          `/admin/users/${encodeURIComponent(userId)}/${banned ? "ban" : "unban"}`,
          { method: "POST", body: "{}" },
        ),
  venues: (filters?: VenueFilters, offset = 0) =>
    useMock ? mockApi.venues(filters, offset) : request<VenuePage>(venuesPath(filters, offset)),
  venue: (venueId: string) =>
    useMock ? mockApi.venue(venueId) : request<{ venue: Venue }>(`/venues/${encodeURIComponent(venueId)}`),
  mapPoints: (category?: string | null) =>
    useMock
      ? mockApi.mapPoints(category)
      : request<MapPoints>(`/map${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  /** cityId: the city chosen in «Каталог мест», open or not; null — the administrator's own city. */
  adminVenues: (status: VenueStatus, filters?: VenueFilters, offset = 0, cityId?: string | null) =>
    useMock
      ? mockApi.adminVenues(status, filters, offset, cityId)
      : request<AdminVenuePage>(adminVenuesPath(status, filters, offset, cityId)),
  adminCreateVenue: (draft: VenueDraft, cityId?: string | null) =>
    useMock
      ? mockApi.adminCreateVenue(draft)
      : request<{ venueId: string }>("/admin/venues", {
          method: "POST",
          body: JSON.stringify({ ...draft, cityId: cityId ?? undefined }),
        }),
  adminSetCityActive: (cityId: string, isActive: boolean) =>
    useMock
      ? mockApi.adminSetCityActive(cityId, isActive)
      : request<{ cities: AdminCity[] }>("/admin/cities/active", {
          method: "POST",
          body: JSON.stringify({ cityId, isActive }),
        }),
  adminUpdateVenue: (
    venueId: string,
    update: { status: VenueStatus; categoryId: string; priceLevel: VenuePriceLevel | null; featured: boolean },
  ) =>
    useMock
      ? mockApi.adminUpdateVenue(venueId, update)
      : request<{ updated: true }>(`/admin/venues/${encodeURIComponent(venueId)}`, {
          method: "PATCH",
          body: JSON.stringify(update),
        }),
  adminPublishVenues: (ids: string[]) =>
    useMock
      ? mockApi.adminPublishVenues(ids)
      : request<{ published: number }>("/admin/venues/publish", { method: "POST", body: JSON.stringify({ ids }) }),
  /** elements: the Overpass answer the app got itself; without it the server asks Overpass. */
  adminImportVenues: (categoryId: string, elements?: unknown[], cityId?: string | null) =>
    useMock
      ? mockApi.adminImportVenues(categoryId)
      : request<VenueImportResult>("/admin/venues/import", {
          method: "POST",
          body: JSON.stringify({ categoryId, elements, cityId: cityId ?? undefined }),
        }),
  calendarLink: (id: string) =>
    useMock
      ? mockApi.calendarLink(id)
      : request<{ icsUrl: string }>(
          `/events/${encodeURIComponent(id)}/calendar-link`,
          { method: "POST" },
        ),
};
