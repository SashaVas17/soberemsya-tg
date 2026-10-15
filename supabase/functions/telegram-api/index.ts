import { createAdminClient } from "../_shared/admin-client.ts";
import {
  API_JSON_BODY_LIMIT_BYTES,
  OSM_IMPORT_BODY_LIMIT_BYTES,
  readJsonObject,
  TELEGRAM_AUTH_BODY_LIMIT_BYTES,
} from "../_shared/bounded-json.ts";
import { buildIcs, isCalendarTicketValid, signCalendarTicket } from "../_shared/calendar.ts";
import { assertEventAvailable, assertFullEventReadAccess, assertOwner, parseStartParam, type Status } from "../_shared/domain.ts";
import { organizerEventPayload, participantEventPayload, privateInviteEventPayload, resolveEventViewerRole, type EventViewerRole } from "../_shared/event-payload.ts";
import {
  browserPreflightResponse,
  errorResponse,
  json,
  withBrowserCors,
} from "../_shared/http.ts";
import { meetingListItem } from "../_shared/meeting-list.ts";
import { collectVisibleMeetings } from "../_shared/meetings.ts";
import {
  encodeMyMeetingsCursor,
  parseMyMeetingsCursor,
  parseMyMeetingsLimit,
  parseMyMeetingsRole,
  type MyMeetingsRole,
} from "../_shared/my-meetings-page.ts";
import { buildPublicEventPreview } from "../_shared/public-preview.ts";
import { buildPublicFeedItem, encodePublicFeedCursor, parsePublicFeedCursor, parsePublicFeedLimit, type PublicFeedEvent } from "../_shared/public-feed.ts";
import { applicationError } from "../_shared/errors.ts";
import { TELEGRAM_INIT_DATA_EXPIRED, validateTelegramInitData } from "../_shared/telegram.ts";
import { parseCreateMeetingMode } from "../_shared/open-meetings.ts";
import { createJoinRequestErrorToken, createJoinRequestHttpError, createJoinRequestHttpResult, type CreateJoinRequestRow } from "../_shared/join-request.ts";
import { joinRequestDecisionErrorToken, joinRequestDecisionHttpError, joinRequestDecisionResponse, organizerJoinRequestsResponse, resolveJoinRequestDecisionRetry, type JoinRequestDecisionAction, type JoinRequestListRow, type RequesterProfileRow } from "../_shared/organizer-join-requests.ts";
import { leaveParticipationErrorToken, leaveParticipationHttpError } from "../_shared/leave-participation.ts";
import { removeEventParticipantErrorToken, removeEventParticipantHttpError } from "../_shared/remove-event-participant.ts";
import { responseSaveErrorToken, responseSaveHttpError } from "../_shared/response-save.ts";
import { optionAdditionErrorToken, optionAdditionHttpError } from "../_shared/event-option-addition.ts";
import { participantOptionProposalErrorToken, participantOptionProposalHttpError } from "../_shared/participant-option-proposal.ts";
import { finalOptionRemovalHttpError } from "../_shared/final-option-removal.ts";
import {
  eventCreationErrorToken,
  eventCreationHttpError,
  eventCreationRequestHash,
  parseClientRequestId,
} from "../_shared/event-creation.ts";
import { notificationSettingsResponse, parseNotificationSettingsUpdate } from "../_shared/notification-settings.ts";
import { groupLinkExpiredError, groupLinkNotIssuerError, parseGroupToken } from "../_shared/group-chats.ts";
import { eventDeepLink } from "../_shared/notification-messages.ts";
import { isAdminTelegramId, parseAdminIds, parseClientAnalyticsEvent, startParamSource } from "../_shared/admin-stats.ts";
import { buildShareCard, parseShareCardKind } from "../_shared/share-card.ts";
import { type Language, LANGUAGE_HEADER, languageFromTelegram, parseLanguage } from "../_shared/i18n.ts";
import {
  adminCity,
  adminCityResponse,
  cityHttpError,
  cityTimeZone,
  citiesFromRows,
  type CityRow,
  parseCityActive,
  parseCityId,
  publicCity,
  requireActiveCity,
  resolveUserCity,
  userCityResponse,
} from "../_shared/cities.ts";
import {
  categoriesFromRows,
  categoryById,
  type CategoryRow,
  parseCategoryId,
  parseFeedSearch,
  titleSearchPattern,
} from "../_shared/categories.ts";
import {
  type BlockedUserRow,
  blockedUsersResponse,
  moderationHttpError,
  parseModerationTarget,
  parseReportId,
  parseReportInput,
  parseReportResolution,
  parseReportStatusFilter,
  parseUserId,
  previewHiddenFromViewer,
  restrictionHttpError,
} from "../_shared/moderation.ts";
import {
  adminVenueResponse,
  chunk,
  cityMapBounds,
  mapPointsFromRpc,
  optionalVenueId,
  nextVenueOffset,
  OVERPASS_MAX_RESPONSE_BYTES,
  OVERPASS_URLS,
  overpassFailed,
  overpassClientSource,
  overpassQuery,
  overpassTruncated,
  osmImportCategories,
  parseOsmClientElements,
  parseOsmImportRequest,
  parseVenueCreate,
  parseVenueId,
  parseVenueIds,
  parseVenueListFilters,
  parseVenueStatus,
  parseVenueUpdate,
  readBoundedJson,
  VENUE_COLUMNS,
  VENUE_PAGE_SIZE,
  venueHttpError,
  venueResponse,
  venuesFromOverpass,
  type VenueListFilters,
  type VenueRow,
} from "../_shared/venues.ts";

type Db = ReturnType<typeof createAdminClient>;
type AppUser = { id: string; telegram_user_id: string; username: string | null; first_name: string; last_name: string | null; photo_url: string | null };
// language: of this request — the app sends its own, otherwise Telegram's.
type AuthContext = { user: AppUser; startParam: string | null; language: Language };
type FullEventRow = { id: string; owner_user_id: string | null; title: string; description: string; budget_limit: number; visibility: string | null; max_participants: number | null; status: Status; final_place_id: string | null; final_time_option_id: string | null; created_at: string; deleted_at: string | null; city_id: string; category_id: string | null; hidden_at: string | null };
type PreviewEventRow = Pick<FullEventRow, "id" | "owner_user_id" | "title" | "description" | "budget_limit" | "visibility" | "max_participants" | "status" | "deleted_at" | "city_id" | "category_id" | "hidden_at">;
type PublicFeedEventRow = Pick<FullEventRow, "id" | "owner_user_id" | "title" | "description" | "budget_limit" | "max_participants" | "status" | "created_at" | "category_id">;
type MyMeetingsEventRow = Pick<FullEventRow, "id" | "title" | "status" | "final_place_id" | "final_time_option_id" | "created_at">;
type OrganizerEventRow = Pick<FullEventRow, "owner_user_id" | "visibility">;
type JoinRequestDecisionRpcRow = { request_id: string; participant_id?: string };
type JoinRequestStateRow = { status: string; requester_user_id: string };
type LeaveParticipationRow = { event_id: string };
type RemoveEventParticipantRow = { event_id: string };
type SaveEventResponseRow = { participant_id: string };
type EventOptionAdditionRow = { option_id: string };
type EventOptionProposalRow = { option_id: string };
type CreateEventRow = { event_id: string };
type CreateEventIdempotentRow = { event_id: string; replayed: boolean };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = (Deno.env.get("TELEGRAM_DB_SECRET_KEY") ?? "").trim();
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const calendarSigningSecret = Deno.env.get("TELEGRAM_CALENDAR_SIGNING_SECRET") ?? "";
const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "flocklyappbot";
const appShortName = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "app";
const adminIds = parseAdminIds(Deno.env.get("TELEGRAM_ADMIN_IDS"));
const db = createAdminClient(supabaseUrl, serviceKey);

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`; }

function invalidRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function textField(
  payload: Record<string, unknown>,
  key: string,
  maxLength: number,
  message: string,
) {
  const value = payload[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") invalidRequest(message);
  const text = value.trim();
  if (text.length > maxLength) invalidRequest(message);
  return text;
}

function arrayField(
  payload: Record<string, unknown>,
  key: string,
  message: string,
) {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) invalidRequest(message);
  return value;
}

function stringArrayField(
  payload: Record<string, unknown>,
  key: string,
  message: string,
) {
  const values = arrayField(payload, key, message);
  if (values.some((value) => typeof value !== "string")) invalidRequest(message);
  return values as string[];
}

function budgetField(value: unknown) {
  const budget = Number(value ?? 0);
  if (!Number.isInteger(budget) || budget < 0 || budget > 2_147_483_647)
    invalidRequest("Укажите корректный бюджет.");
  return budget;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function authenticate(request: Request, bodyInitData?: string): Promise<AuthContext> {
  const raw = bodyInitData ?? request.headers.get("x-telegram-init-data") ?? "";
  let validated;
  try {
    validated = await validateTelegramInitData(raw, botToken, { maxAgeSeconds: 3600 });
  } catch (error) {
    console.error("telegram_auth_validation_failed", error instanceof Error ? error.message : "unknown");
    const message = "Не удалось подтвердить данные Telegram. Откройте Mini App заново.";
    // Only a correctly signed but stale initData is fixed by reopening the app.
    if (error instanceof Error && error.message === TELEGRAM_INIT_DATA_EXPIRED)
      throw applicationError("TELEGRAM_SESSION_EXPIRED", 401, message);
    throw Object.assign(new Error(message), { status: 401 });
  }
  const profile = validated.user;
  const { data, error } = await db.rpc("ensure_telegram_user", {
    p_telegram_user_id: profile.id,
    p_username: profile.username ?? null,
    p_first_name: profile.first_name,
    p_last_name: profile.last_name ?? null,
    p_language_code: profile.language_code ?? null,
    p_photo_url: profile.photo_url ?? null,
  }).single<AppUser>();
  if (error) {
    console.error("telegram_user_ensure_failed", error.code);
    throw Object.assign(new Error("Не удалось сохранить пользователя Telegram."), { status: 503 });
  }
  return {
    user: data,
    startParam: validated.startParam,
    language: parseLanguage(request.headers.get(LANGUAGE_HEADER)) ?? languageFromTelegram(profile.language_code),
  };
}

// Cities and categories change rarely (the owner edits them by hand), so a
// warm function instance reuses them for a minute.
const REFERENCE_DATA_TTL_MS = 60_000;

function cachedFor<T>(ttlMs: number, load: () => Promise<T>) {
  let cached: { loadedAt: number; value: T } | null = null;
  const fresh = async () => {
    const value = await load();
    cached = { loadedAt: Date.now(), value };
    return value;
  };
  return Object.assign(async () => {
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.value;
    return await fresh();
  }, { fresh });
}

const loadCities = cachedFor(REFERENCE_DATA_TTL_MS, async () => {
  const { data, error } = await db.from("cities").select("id,name,timezone,is_active,sort_order");
  if (error) throw error;
  return citiesFromRows((data ?? []) as CityRow[]);
});

const loadCategories = cachedFor(REFERENCE_DATA_TTL_MS, async () => {
  const { data, error } = await db.from("meeting_categories").select("id,name,sort_order,is_active");
  if (error) throw error;
  return categoriesFromRows((data ?? []) as CategoryRow[]);
});

async function loadUserCityId(userId: string) {
  return (await loadUserProfile(userId)).cityId;
}

async function loadUserProfile(userId: string) {
  const { data, error } = await db.from("users").select("city_id,community_rules_accepted_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return {
    cityId: (data?.city_id as string | null | undefined) ?? null,
    communityRulesAccepted: Boolean(data?.community_rules_accepted_at),
  };
}

/** Whether either of two users blocked the other. */
async function usersBlockedBetween(first: string, second: string) {
  const { data, error } = await db
    .from("user_blocks")
    .select("blocker_user_id")
    .or(`and(blocker_user_id.eq.${first},blocked_user_id.eq.${second}),and(blocker_user_id.eq.${second},blocked_user_id.eq.${first})`)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function userCity(request: Request, auth: AuthContext) {
  if (request.method === "PUT") {
    const body = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
    const cityId = parseCityId(body.cityId);
    const cities = await loadCities();
    const city = requireActiveCity(cities, cityId);
    const { error } = await db.from("users").update({ city_id: city.id }).eq("id", auth.user.id);
    if (error) throw error;
    return json(userCityResponse(cities, city.id));
  }
  const [cities, chosenCityId] = await Promise.all([loadCities(), loadUserCityId(auth.user.id)]);
  return json(userCityResponse(cities, chosenCityId));
}

async function health() {
  return json({ ok: true });
}

async function loadFullEventRow(eventId: string) {
  const { data: event, error } = await db.from("events").select("id,owner_user_id,title,description,budget_limit,visibility,max_participants,status,final_place_id,final_time_option_id,created_at,deleted_at,city_id,category_id,hidden_at").eq("id", eventId).is("deleted_at", null).maybeSingle<FullEventRow>();
  if (error) throw error;
  assertEventAvailable(event);
  return event;
}

async function currentParticipantExists(eventId: string, userId: string) {
  const { data: participant, error } = await db
    .from("participants")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(participant);
}

async function eventPayload(
  eventId: string,
  userId: string,
  loadedEvent?: FullEventRow,
  viewerRole?: EventViewerRole,
) {
  const event = loadedEvent ?? await loadFullEventRow(eventId);
  const [{ data: times, error: timeError }, { data: places, error: placeError }, { data: people, error: peopleError }, categories] = await Promise.all([
    db.from("time_options").select("id,starts_at").eq("event_id", eventId).order("starts_at"),
    db.from("place_options").select("id,title,area,estimated_budget").eq("event_id", eventId),
    db.from("participants").select("id,user_id,name,area,budget,preferences,restrictions").eq("event_id", eventId).order("created_at"),
    loadCategories(),
  ]);
  if (timeError || placeError || peopleError) throw timeError ?? placeError ?? peopleError;
  const participantIds = (people ?? []).map((person) => person.id);
  const [{ data: votes, error: voteError }, { data: placeVotes, error: placeVoteError }] = participantIds.length
    ? await Promise.all([
      db.from("availability_votes").select("participant_id,time_option_id,is_available").in("participant_id", participantIds),
      db.from("place_votes").select("participant_id,place_option_id").in("participant_id", participantIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (voteError || placeVoteError) throw voteError ?? placeVoteError;
  const role = viewerRole ?? resolveEventViewerRole({
    visibility: event.visibility,
    ownerUserId: event.owner_user_id,
    currentUserId: userId,
    participantExists: await currentParticipantExists(eventId, userId),
  });
  const source = {
    event,
    times: times ?? [],
    places: places ?? [],
    participants: people ?? [],
    votes: votes ?? [],
    placeVotes: placeVotes ?? [],
    currentUserId: userId,
    category: categoryById(categories, event.category_id),
  };
  // The organizer learns that the administrator took the meeting off the feed.
  if (role === "owner")
    return { ...organizerEventPayload(source), ...(event.hidden_at ? { hiddenByModerator: true } : {}) };
  if (role === "participant") return participantEventPayload(source);
  return privateInviteEventPayload(source);
}

async function fullEventForRequest(eventId: string, userId: string) {
  const event = await loadFullEventRow(eventId);
  const participantExists = event.owner_user_id === userId
    ? false
    : await currentParticipantExists(eventId, userId);
  assertFullEventReadAccess({ visibility: event.visibility, ownerUserId: event.owner_user_id, currentUserId: userId, participantExists });
  return eventPayload(
    eventId,
    userId,
    event,
    resolveEventViewerRole({
      visibility: event.visibility,
      ownerUserId: event.owner_user_id,
      currentUserId: userId,
      participantExists,
    }),
  );
}

async function publicEventPreview(eventId: string, userId: string, language: Language) {
  const { data: event, error } = await db.from("events").select("id,owner_user_id,title,description,budget_limit,visibility,max_participants,status,deleted_at,city_id,category_id,hidden_at").eq("id", eventId).is("deleted_at", null).maybeSingle<PreviewEventRow>();
  if (error) throw error;
  assertEventAvailable(event);
  if (event.visibility !== "public")
    throw Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 });

  const [{ data: times, error: timeError }, { data: people, error: peopleError }, cities, categories] = await Promise.all([
    db.from("time_options").select("starts_at").eq("event_id", eventId),
    db.from("participants").select("user_id").eq("event_id", eventId),
    loadCities(),
    loadCategories(),
  ]);
  if (timeError || peopleError) throw timeError ?? peopleError;
  const participantUserIds = (people ?? []).map((person) => person.user_id as string | null);
  const participantExists = participantUserIds.includes(userId);
  const isOwner = event.owner_user_id === userId;
  if (!isOwner && !participantExists) {
    const blocked = event.owner_user_id !== null && await usersBlockedBetween(userId, event.owner_user_id);
    // Answers like a missing meeting, so a blocked person learns nothing.
    if (previewHiddenFromViewer({ hidden: event.hidden_at !== null, blocked, isOwner, isParticipant: participantExists }))
      throw Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 });
  }
  let requestStatus: string | null = null;
  if (!participantExists) {
    const { data: joinRequest, error: joinRequestError } = await db.from("join_requests").select("status").eq("event_id", eventId).eq("requester_user_id", userId).maybeSingle();
    if (joinRequestError) throw joinRequestError;
    requestStatus = joinRequest?.status ?? null;
  }

  return buildPublicEventPreview({
    event: { id: event.id, title: event.title, description: event.description, status: event.status, budgetLimit: event.budget_limit, maxParticipants: event.max_participants ?? null },
    startsAtValues: (times ?? []).map((time) => time.starts_at),
    participantUserIds,
    ownerUserId: event.owner_user_id,
    participantExists,
    requestStatus,
    timeZone: cityTimeZone(cities, event.city_id),
    category: categoryById(categories, event.category_id),
    language,
  });
}

async function createEvent(request: Request, auth: AuthContext) {
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const title = textField(payload, "title", 200, "Укажите корректное название встречи.");
  const description = textField(payload, "description", 4_000, "Описание слишком длинное.");
  const { visibility, maxParticipants } = parseCreateMeetingMode(payload);
  const times = [...new Set(stringArrayField(
    payload,
    "timeOptions",
    "Укажите не более 50 вариантов времени.",
  ).filter((value) => !Number.isNaN(Date.parse(value))))].sort();
  if (!title) throw Object.assign(new Error("Укажите название встречи."), { status: 400 });
  if (!times.length) throw Object.assign(new Error("Добавьте хотя бы один вариант даты и времени."), { status: 400 });
  const places = arrayField(
    payload,
    "placeOptions",
    "Укажите не более 50 вариантов мест.",
  ).flatMap((value) => {
    const place = record(value);
    if (!place) return [];
    const placeTitle = textField(place, "title", 200, "Название места слишком длинное.");
    if (!placeTitle) return [];
    return [{
      id: id("place"),
      title: placeTitle,
      area: textField(place, "area", 200, "Район слишком длинный."),
      estimatedBudget: budgetField(place.estimatedBudget),
      // A place chosen from the catalogue; the RPC links only a published
      // venue of the meeting's city, so a stale id just leaves no link.
      venueId: optionalVenueId(place.venueId),
    }];
  });
  const placeVenues = Object.fromEntries(
    places.flatMap((place) => (place.venueId ? [[place.id, place.venueId]] : [])),
  );
  const linksVenues = Object.keys(placeVenues).length > 0;
  const clientRequestId = parseClientRequestId(payload.clientRequestId);
  // Only the format here: the RPC checks that the category is active, and
  // skips the check for a replay, which must return the meeting it created.
  const categoryId = parseCategoryId(payload.category);
  // Checked only after the meeting exists: rejecting a replayed create with
  // a 4xx would make the client forget its idempotency key.
  const groupToken = parseGroupToken(payload.groupToken);
  const budgetLimit = budgetField(payload.budgetLimit);
  const rpcArgs = {
    p_event_id: id("evt"),
    p_actor_user_id: auth.user.id,
    p_admin_token: id("backup"),
    p_title: title,
    p_description: description,
    p_budget_limit: budgetLimit,
    p_visibility: visibility,
    p_max_participants: maxParticipants,
    p_time_options: times.map((startsAt) => ({ id: id("time"), startsAt })),
    p_place_options: places.map(({ venueId: _venueId, ...place }) => place),
    p_category_id: categoryId,
    ...(linksVenues ? { p_place_venues: placeVenues } : {}),
  };
  // The categorized wrappers call create_event_idempotent / create_event_atomic
  // and set the category in the same transaction; the *_with_venues ones also
  // link places chosen from the venue catalogue.
  const rpcName = linksVenues
    ? clientRequestId ? "create_event_idempotent_with_venues" : "create_event_with_venues"
    : clientRequestId ? "create_event_idempotent_categorized" : "create_event_categorized";
  const { data, error } = await db.rpc(
    rpcName,
    clientRequestId
      ? {
        p_client_request_id: clientRequestId,
        p_request_hash: await eventCreationRequestHash({
          title,
          description,
          budgetLimit,
          visibility,
          maxParticipants,
          startsAt: times,
          places,
          categoryId,
        }),
        ...rpcArgs,
      }
      : rpcArgs,
  ).single<CreateEventIdempotentRow | CreateEventRow>();
  if (error) {
    console.error(
      `${rpcName}_rpc_failed`,
      error.code,
      eventCreationErrorToken(error) ?? "unknown",
    );
    throw restrictionHttpError(error) ?? eventCreationHttpError(error);
  }
  const eventId = data?.event_id;
  const replayed = !!data && "replayed" in data && data.replayed === true;
  if (!eventId || (!replayed && eventId !== rpcArgs.p_event_id))
    throw new Error("Create event RPC returned no event.");
  const groupAttached = groupToken ? await attachEventToGroup(eventId, auth.user.id, groupToken) : undefined;
  if (!replayed) await track("meeting_created", auth.user.id, eventId, groupToken ? "group" : null);
  const body = { event: await eventPayload(eventId, auth.user.id), ...(groupToken ? { groupAttached } : {}) };
  return json(body, replayed ? 200 : 201);
}

async function createJoinRequest(eventId: string, auth: AuthContext) {
  // Also checks bans, hidden meetings and blocks, and counts the request
  // against the rate limit.
  const { data, error } = await db.rpc("create_join_request_moderated", {
    p_event_id: eventId,
    p_requester_user_id: auth.user.id,
  }).single<CreateJoinRequestRow>();
  if (error) {
    console.error(
      "create_join_request_rpc_failed",
      error.code,
      createJoinRequestErrorToken(error) ?? "unknown",
    );
    throw restrictionHttpError(error) ?? createJoinRequestHttpError(error);
  }
  const result = createJoinRequestHttpResult(data);
  if (result.status === 201) await track("join_requested", auth.user.id, eventId);
  return json(result.body, result.status);
}

async function organizerJoinRequests(eventId: string, auth: AuthContext) {
  const { data: event, error: eventError } = await db
    .from("events")
    .select("owner_user_id,visibility")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle<OrganizerEventRow>();
  if (eventError) throw eventError;
  assertEventAvailable(event);
  if (event.owner_user_id !== auth.user.id)
    throw joinRequestDecisionHttpError("NOT_EVENT_OWNER");
  if (event.visibility !== "public")
    throw joinRequestDecisionHttpError("JOIN_REQUEST_NOT_ALLOWED");

  const { data: requests, error: requestError } = await db
    .from("join_requests")
    .select("id,status,created_at,requester_user_id")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .order("created_at");
  if (requestError) throw requestError;
  const rows = (requests ?? []) as JoinRequestListRow[];
  const requesterIds = [...new Set(rows.map((row) => row.requester_user_id))];
  if (!requesterIds.length) return json({ requests: [] });

  const { data: profiles, error: profileError } = await db
    .from("users")
    .select("id,first_name,last_name,username")
    .in("id", requesterIds);
  if (profileError) throw profileError;
  return json(
    organizerJoinRequestsResponse(rows, (profiles ?? []) as RequesterProfileRow[]),
  );
}

function assertJoinRequestId(requestId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw Object.assign(new Error("Заявка не найдена."), { status: 404 });
}

async function loadJoinRequestRetryState(eventId: string, requestId: string) {
  const { data: request, error: requestError } = await db
    .from("join_requests")
    .select("status,requester_user_id")
    .eq("event_id", eventId)
    .eq("id", requestId)
    .maybeSingle<JoinRequestStateRow>();
  if (requestError) throw requestError;
  if (!request) return null;

  const { data: participant, error: participantError } = await db
    .from("participants")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", request.requester_user_id)
    .maybeSingle();
  if (participantError) throw participantError;
  return {
    status: request.status,
    requesterUserId: request.requester_user_id,
    participantExists: Boolean(participant),
  };
}

async function decideJoinRequest(
  action: JoinRequestDecisionAction,
  eventId: string,
  requestId: string,
  auth: AuthContext,
) {
  assertJoinRequestId(requestId);
  const rpcName = action === "approve"
    ? "approve_join_request"
    : "reject_join_request";
  const { data, error } = await db.rpc(rpcName, {
    p_event_id: eventId,
    p_request_id: requestId,
    p_actor_user_id: auth.user.id,
  }).single<JoinRequestDecisionRpcRow>();

  if (error) {
    const token = joinRequestDecisionErrorToken(error, action);
    console.error(`${rpcName}_rpc_failed`, error.code, token ?? "unknown");
    const retrySource = token === "JOIN_REQUEST_NOT_PENDING"
      ? "not_pending"
      : action === "approve" && token === "JOIN_REQUESTS_CLOSED"
        ? "closed"
        : null;
    if (retrySource) {
      const state = await loadJoinRequestRetryState(eventId, requestId);
      return json(
        resolveJoinRequestDecisionRetry(action, requestId, state, retrySource),
      );
    }
    throw joinRequestDecisionHttpError(token);
  }

  if (!data?.request_id) throw new Error("Join request RPC returned no request.");
  return json(
    joinRequestDecisionResponse(
      data.request_id,
      action === "approve" ? "approved" : "rejected",
    ),
  );
}

async function saveResponse(request: Request, eventId: string, auth: AuthContext) {
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const budget = budgetField(payload.budget);
  const availableTimeOptionIds = stringArrayField(
    payload,
    "availableTimeOptionIds",
    "Укажите не более 50 вариантов времени.",
  );
  const selectedPlaceOptionIds = Object.hasOwn(payload, "selectedPlaceOptionIds")
    ? stringArrayField(
      payload,
      "selectedPlaceOptionIds",
      "Укажите не более 50 вариантов мест.",
    )
    : null;

  const { error } = await db.rpc("save_event_response", {
    p_event_id: eventId,
    p_actor_user_id: auth.user.id,
    p_area: textField(payload, "area", 200, "Район слишком длинный."),
    p_budget: budget,
    p_preferences: textField(payload, "preferences", 4_000, "Предпочтения слишком длинные."),
    p_restrictions: textField(payload, "restrictions", 4_000, "Ограничения слишком длинные."),
    p_available_time_option_ids: availableTimeOptionIds,
    p_selected_place_option_ids: selectedPlaceOptionIds,
  }).single<SaveEventResponseRow>();
  if (error) {
    console.error(
      "save_event_response_rpc_failed",
      error.code,
      responseSaveErrorToken(error) ?? "unknown",
    );
    throw responseSaveHttpError(error);
  }
  await track("response_saved", auth.user.id, eventId);
  return json({ event: await eventPayload(eventId, auth.user.id) });
}

async function proposeTimeOption(request: Request, eventId: string, auth: AuthContext) {
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const startsAt = String(payload.startsAt ?? "");
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) invalidRequest("Некорректная дата.");
  const { error } = await db.rpc("propose_event_time_option_limited", {
    p_event_id: eventId,
    p_actor_user_id: auth.user.id,
    p_option_id: id("time"),
    p_starts_at: startsAt,
  }).single<EventOptionProposalRow>();
  if (error) {
    console.error(
      "propose_event_time_option_rpc_failed",
      error.code,
      participantOptionProposalErrorToken(error) ?? "unknown",
    );
    throw restrictionHttpError(error) ?? participantOptionProposalHttpError(error);
  }
  return json({ event: await eventPayload(eventId, auth.user.id) });
}

async function proposePlaceOption(request: Request, eventId: string, auth: AuthContext) {
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const place = record(payload.place) ?? {};
  const title = textField(place, "title", 200, "Название места слишком длинное.");
  if (!title) invalidRequest("Укажите место.");
  const { error } = await db.rpc("propose_event_place_option_limited", {
    p_event_id: eventId,
    p_actor_user_id: auth.user.id,
    p_option_id: id("place"),
    p_title: title,
    p_area: textField(place, "area", 200, "Район слишком длинный."),
    p_estimated_budget: budgetField(place.estimatedBudget),
  }).single<EventOptionProposalRow>();
  if (error) {
    console.error(
      "propose_event_place_option_rpc_failed",
      error.code,
      participantOptionProposalErrorToken(error) ?? "unknown",
    );
    throw restrictionHttpError(error) ?? participantOptionProposalHttpError(error);
  }
  return json({ event: await eventPayload(eventId, auth.user.id) });
}

async function leaveParticipation(eventId: string, auth: AuthContext) {
  const { data, error } = await db.rpc("leave_event_participation", {
    p_event_id: eventId,
    p_user_id: auth.user.id,
  }).single<LeaveParticipationRow>();
  if (error) {
    console.error(
      "leave_event_participation_rpc_failed",
      error.code,
      leaveParticipationErrorToken(error) ?? "unknown",
    );
    throw leaveParticipationHttpError(error);
  }
  if (data?.event_id !== eventId)
    throw new Error("Leave participation RPC returned no event.");
  return json({ left: true });
}

function unavailableManagedEventError() {
  return Object.assign(new Error("Встреча не найдена."), { status: 404 });
}

async function updateActiveOwnedEvent(
  eventId: string,
  ownerUserId: string,
  changes: Record<string, unknown>,
) {
  const { data, error } = await db
    .from("events")
    .update(changes)
    .eq("id", eventId)
    .eq("owner_user_id", ownerUserId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw unavailableManagedEventError();
}

async function manageEvent(request: Request, eventId: string, auth: AuthContext) {
  const { data: event, error } = await db.from("events").select("owner_user_id,status").eq("id", eventId).is("deleted_at", null).maybeSingle(); if (error) throw error; if (!event) throw unavailableManagedEventError(); assertOwner(event.owner_user_id, auth.user.id);
  if (request.method === "DELETE") { await updateActiveOwnedEvent(eventId, auth.user.id, { deleted_at: new Date().toISOString() }); return json({ deleted: true }); }
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  switch (payload.action) {
    case "update_details": { const title = textField(payload, "title", 200, "Название встречи слишком длинное."); if (!title) throw Object.assign(new Error("Название не может быть пустым."), { status: 400 }); await updateActiveOwnedEvent(eventId, auth.user.id, { title, description: textField(payload, "description", 4_000, "Описание слишком длинное.") }); break; }
    case "set_category": {
      // Separate from update_details: a category change notifies nobody.
      const categoryId = parseCategoryId(payload.category);
      if (categoryId && !categoryById(await loadCategories(), categoryId))
        throw Object.assign(new Error("Эта категория недоступна."), { status: 400 });
      await updateActiveOwnedEvent(eventId, auth.user.id, { category_id: categoryId });
      break;
    }
    case "add_time": { const startsAt = String(payload.startsAt ?? ""); if (Number.isNaN(Date.parse(startsAt))) throw Object.assign(new Error("Некорректная дата."), { status: 400 }); const { error: rpcError } = await db.rpc("add_event_time_option", { p_event_id: eventId, p_actor_user_id: auth.user.id, p_option_id: id("time"), p_starts_at: startsAt }).single<EventOptionAdditionRow>(); if (rpcError) { console.error("add_event_time_option_rpc_failed", rpcError.code, optionAdditionErrorToken(rpcError) ?? "unknown"); throw optionAdditionHttpError(rpcError); } break; }
    case "remove_time": { const optionId = String(payload.timeOptionId ?? ""); const { error: deleteError } = await db.from("time_options").delete().eq("id", optionId).eq("event_id", eventId); if (deleteError) throw finalOptionRemovalHttpError(deleteError, "time"); break; }
    case "add_place": { const place = record(payload.place) ?? {}; const title = textField(place, "title", 200, "Название места слишком длинное."); if (!title) throw Object.assign(new Error("Укажите место."), { status: 400 }); const { error: rpcError } = await db.rpc("add_event_place_option", { p_event_id: eventId, p_actor_user_id: auth.user.id, p_option_id: id("place"), p_title: title, p_area: textField(place, "area", 200, "Район слишком длинный."), p_estimated_budget: budgetField(place.estimatedBudget) }).single<EventOptionAdditionRow>(); if (rpcError) { console.error("add_event_place_option_rpc_failed", rpcError.code, optionAdditionErrorToken(rpcError) ?? "unknown"); throw optionAdditionHttpError(rpcError); } break; }
    case "remove_place": { const { error: deleteError } = await db.from("place_options").delete().eq("id", String(payload.placeOptionId ?? "")).eq("event_id", eventId); if (deleteError) throw finalOptionRemovalHttpError(deleteError, "place"); break; }
    case "close": { await updateActiveOwnedEvent(eventId, auth.user.id, { status: "place_selection" }); break; }
    case "cancel": { if (event.status === "cancelled") throw Object.assign(new Error("Встреча уже отменена."), { status: 409 }); await updateActiveOwnedEvent(eventId, auth.user.id, { status: "cancelled" }); break; }
    case "reopen": { if (event.status === "cancelled") throw Object.assign(new Error("Отменённую встречу нельзя возобновить."), { status: 409 }); await updateActiveOwnedEvent(eventId, auth.user.id, { status: "collecting", final_time_option_id: null, final_place_id: null }); break; }
    case "decide": { if (event.status === "cancelled") throw Object.assign(new Error("Встреча отменена."), { status: 409 }); const timeId = String(payload.finalTimeOptionId ?? ""); const placeId = String(payload.finalPlaceId ?? ""); const [{ data: time }, { data: place }] = await Promise.all([db.from("time_options").select("id").eq("id", timeId).eq("event_id", eventId).maybeSingle(), db.from("place_options").select("id").eq("id", placeId).eq("event_id", eventId).maybeSingle()]); if (!time || !place) throw Object.assign(new Error("Выберите допустимые время и место."), { status: 400 }); await updateActiveOwnedEvent(eventId, auth.user.id, { status: "decided", final_time_option_id: timeId, final_place_id: placeId }); break; }
    default: throw Object.assign(new Error("Неизвестное действие."), { status: 400 });
  }
  return json({ event: await eventPayload(eventId, auth.user.id) });
}

// The language chosen in the app settings, for the bot and notifications;
// null returns to «as in Telegram».
async function userLanguagePreference(request: Request, auth: AuthContext) {
  const body = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const language = body.language === null ? null : parseLanguage(body.language);
  if (language === null && body.language !== null) invalidRequest("Некорректный язык.");
  const { error } = await db.rpc("set_user_language", { p_user_id: auth.user.id, p_language: language });
  if (error) throw error;
  return json({ language });
}

// Optional for sign-in: on a failed read the field is left out and the app
// keeps its own choice.
async function storedLanguage(userId: string) {
  const { data, error } = await db.from("users").select("language").eq("id", userId).maybeSingle<{ language: string | null }>();
  if (error) {
    console.error("stored_language_read_failed", error.code);
    return undefined;
  }
  return parseLanguage(data?.language);
}

async function notificationSettings(request: Request, auth: AuthContext) {
  if (request.method === "PUT") {
    const update = parseNotificationSettingsUpdate(
      await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES),
    );
    if (Object.keys(update.preferences).length) {
      const { error } = await db.from("notification_preferences").upsert(
        { user_id: auth.user.id, ...update.preferences, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }
    if (update.writeAccessGranted) {
      const { error } = await db.from("users").update({ can_message: true }).eq("id", auth.user.id);
      if (error) throw error;
    }
  }
  const [{ data: preferences, error: preferencesError }, { data: user, error: userError }] = await Promise.all([
    db.from("notification_preferences").select("response_mode,reminder_24h,reminder_2h").eq("user_id", auth.user.id).maybeSingle(),
    db.from("users").select("can_message").eq("id", auth.user.id).maybeSingle(),
  ]);
  if (preferencesError || userError) throw preferencesError ?? userError;
  return json(notificationSettingsResponse(preferences, user?.can_message ?? null));
}

async function meetings(auth: AuthContext) {
  const [{ data: owned, error: ownedError }, { data: participations, error: participationError }] = await Promise.all([db.from("events").select("id").eq("owner_user_id", auth.user.id).is("deleted_at", null).order("created_at", { ascending: false }), db.from("participants").select("event_id").eq("user_id", auth.user.id)]);
  if (ownedError || participationError) throw ownedError ?? participationError;
  const ownedIds = (owned ?? []).map((item) => item.id); const participatingIds = [...new Set((participations ?? []).map((item) => item.event_id))].filter((eventId) => !ownedIds.includes(eventId));
  const mapItem = async (eventId: string, role: "owner" | "participant") =>
    meetingListItem(await eventPayload(eventId, auth.user.id), role, auth.language);
  return json(await collectVisibleMeetings(ownedIds, participatingIds, mapItem));
}

async function meetingListPage(
  request: Request,
  auth: AuthContext,
) {
  const url = new URL(request.url);
  const role = parseMyMeetingsRole(url.searchParams.get("role"));
  const limit = parseMyMeetingsLimit(url.searchParams.get("limit"));
  const cursor = parseMyMeetingsCursor(url.searchParams.get("cursor"));
  const cursorFilter = cursor
    ? `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    : null;
  const result = role === "owner"
    ? await (cursorFilter
      ? db
        .from("events")
        .select("id,title,status,final_place_id,final_time_option_id,created_at")
        .eq("owner_user_id", auth.user.id)
        .is("deleted_at", null)
        .or(cursorFilter)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1)
      : db
        .from("events")
        .select("id,title,status,final_place_id,final_time_option_id,created_at")
        .eq("owner_user_id", auth.user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1))
    : await (cursorFilter
      ? db
        .from("events")
        .select("id,title,status,final_place_id,final_time_option_id,created_at,participants!inner(user_id)")
        .eq("participants.user_id", auth.user.id)
        .is("deleted_at", null)
        .or(
          `and(${cursorFilter},or(owner_user_id.neq.${auth.user.id},owner_user_id.is.null))`,
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1)
      : db
        .from("events")
        .select("id,title,status,final_place_id,final_time_option_id,created_at,participants!inner(user_id)")
        .eq("participants.user_id", auth.user.id)
        .is("deleted_at", null)
        .or(`owner_user_id.neq.${auth.user.id},owner_user_id.is.null`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1));
  const { data, error } = result;
  if (error) throw error;
  const rows = (data ?? []) as MyMeetingsEventRow[];
  const page = rows.slice(0, limit);
  const eventIds = page.map((event) => event.id);
  const hasNextPage = rows.length > limit;
  if (!eventIds.length) return json({ items: [], nextCursor: null });

  const [{ data: times, error: timeError }, { data: places, error: placeError }, { data: people, error: peopleError }] =
    await Promise.all([
      db.from("time_options").select("id,event_id,starts_at").in("event_id", eventIds),
      db.from("place_options").select("id,event_id,title").in("event_id", eventIds),
      db.from("participants").select("id,event_id").in("event_id", eventIds),
    ]);
  if (timeError || placeError || peopleError) throw timeError ?? placeError ?? peopleError;

  const timeRows = times ?? [];
  const timeIds = timeRows.map((time) => time.id);
  const { data: votes, error: voteError } = timeIds.length
    ? await db.from("availability_votes").select("time_option_id,is_available").in("time_option_id", timeIds)
    : { data: [], error: null };
  if (voteError) throw voteError;

  const availableCounts = new Map<string, number>();
  for (const vote of votes ?? []) {
    if (vote.is_available)
      availableCounts.set(
        vote.time_option_id,
        (availableCounts.get(vote.time_option_id) ?? 0) + 1,
      );
  }
  const timesByEvent = new Map<string, Array<{ id: string; startsAt: string; availableCount: number }>>();
  for (const time of timeRows) {
    timesByEvent.set(time.event_id, [
      ...(timesByEvent.get(time.event_id) ?? []),
      {
        id: time.id,
        startsAt: time.starts_at,
        availableCount: availableCounts.get(time.id) ?? 0,
      },
    ]);
  }
  const placesByEvent = new Map<string, Array<{ id: string; title: string }>>();
  for (const place of places ?? []) {
    placesByEvent.set(place.event_id, [
      ...(placesByEvent.get(place.event_id) ?? []),
      { id: place.id, title: place.title },
    ]);
  }
  const participantsByEvent = new Map<string, unknown[]>();
  for (const person of people ?? []) {
    participantsByEvent.set(person.event_id, [
      ...(participantsByEvent.get(person.event_id) ?? []),
      person.id,
    ]);
  }
  const lastEvent = page.at(-1);
  return json({
    items: page.map((event) =>
      meetingListItem(
        {
          id: event.id,
          title: event.title,
          status: event.status,
          finalPlaceId: event.final_place_id,
          finalTimeOptionId: event.final_time_option_id,
          timeOptions: timesByEvent.get(event.id) ?? [],
          placeOptions: placesByEvent.get(event.id) ?? [],
          participants: participantsByEvent.get(event.id) ?? [],
          createdAt: event.created_at,
        },
        role,
        auth.language,
      ),
    ),
    nextCursor:
      hasNextPage && lastEvent
        ? encodeMyMeetingsCursor({ createdAt: lastEvent.created_at, id: lastEvent.id })
        : null,
  });
}

function assertParticipantId(participantId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participantId))
    throw Object.assign(new Error("Участник не найден."), { status: 404 });
}

async function removeEventParticipant(
  eventId: string,
  participantId: string,
  auth: AuthContext,
) {
  assertParticipantId(participantId);
  const { data, error } = await db.rpc("remove_event_participant", {
    p_event_id: eventId,
    p_participant_id: participantId,
    p_actor_user_id: auth.user.id,
  }).single<RemoveEventParticipantRow>();
  if (error) {
    console.error(
      "remove_event_participant_rpc_failed",
      error.code,
      removeEventParticipantErrorToken(error) ?? "unknown",
    );
    throw removeEventParticipantHttpError(error);
  }
  if (data?.event_id !== eventId)
    throw new Error("Remove participant RPC returned no event.");
  return json({ removed: true });
}

async function publicEvents(request: Request, auth: AuthContext) {
  const url = new URL(request.url);
  const limit = parsePublicFeedLimit(url.searchParams.get("limit"));
  const cursor = parsePublicFeedCursor(url.searchParams.get("cursor"));
  const requestedCategoryId = parseCategoryId(url.searchParams.get("category"));
  const search = parseFeedSearch(url.searchParams.get("q"));
  // The feed shows the viewer's city; the response also lists the cities and
  // categories to choose from, so the screen needs no extra request.
  const [cities, profile, categories] = await Promise.all([
    loadCities(),
    loadUserProfile(auth.user.id),
    loadCategories(),
  ]);
  const city = resolveUserCity(cities, profile.cityId);
  const category = requestedCategoryId ? categoryById(categories, requestedCategoryId) : null;
  const cityFields = {
    ...userCityResponse(cities, city.id),
    categories,
    communityRulesAccepted: profile.communityRulesAccepted,
  };
  // A deactivated category matches nothing; the current list in the response
  // lets the app drop it instead of retrying an error.
  if (requestedCategoryId && !category) return json({ items: [], nextCursor: null, ...cityFields });
  // In SQL: hidden meetings and those of people blocked either way are left
  // out there, ordered by (created_at, id) desc for the keyset cursor.
  const { data, error } = await db.rpc("public_feed_page", {
    p_viewer_user_id: auth.user.id,
    p_city_id: city.id,
    p_category_id: category?.id ?? null,
    p_title_pattern: search ? titleSearchPattern(search) : null,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit + 1,
  });
  if (error) throw error;
  const page = ((data ?? []) as PublicFeedEventRow[]).slice(0, limit);
  const eventIds = page.map((event) => event.id);
  const hasNextPage = (data ?? []).length > limit;
  if (!eventIds.length) return json({ items: [], nextCursor: null, ...cityFields });

  const [{ data: times, error: timeError }, { data: people, error: peopleError }] =
    await Promise.all([
      db.from("time_options").select("event_id,starts_at").in("event_id", eventIds),
      db.from("participants").select("event_id,user_id").in("event_id", eventIds),
    ]);
  if (timeError || peopleError) throw timeError ?? peopleError;
  const startsByEvent = new Map<string, string[]>();
  for (const time of times ?? [])
    startsByEvent.set(time.event_id, [
      ...(startsByEvent.get(time.event_id) ?? []),
      time.starts_at,
    ]);
  const participantsByEvent = new Map<string, Array<string | null>>();
  for (const person of people ?? [])
    participantsByEvent.set(person.event_id, [
      ...(participantsByEvent.get(person.event_id) ?? []),
      person.user_id as string | null,
    ]);
  const lastEvent = page.at(-1);
  return json({
    items: page.map((event) =>
      buildPublicFeedItem({
        event: {
          id: event.id,
          ownerUserId: event.owner_user_id,
          title: event.title,
          description: event.description,
          budgetLimit: event.budget_limit,
          maxParticipants: event.max_participants,
          status: event.status,
          createdAt: event.created_at,
        } satisfies PublicFeedEvent,
        startsAtValues: startsByEvent.get(event.id) ?? [],
        participantUserIds: participantsByEvent.get(event.id) ?? [],
        timeZone: city.timeZone,
        category: categoryById(categories, event.category_id),
        language: auth.language,
      }),
    ),
    nextCursor:
      hasNextPage && lastEvent
        ? encodePublicFeedCursor({
            createdAt: lastEvent.created_at,
            id: lastEvent.id,
          })
        : null,
    ...cityFields,
  });
}

async function calendarLink(request: Request, eventId: string, auth: AuthContext) {
  if (!calendarSigningSecret)
    throw Object.assign(new Error("Экспорт календаря пока не настроен."), { status: 503 });

  const event = await fullEventForRequest(eventId, auth.user.id);
  if (event.status !== "decided" || !event.finalTimeOptionId || !event.finalPlaceId)
    throw Object.assign(new Error("Итог встречи ещё не выбран."), { status: 409 });

  const expires = Math.floor(Date.now() / 1000) + 10 * 60;
  const signature = await signCalendarTicket(eventId, expires, calendarSigningSecret);
  const url = new URL(request.url);
  const calendarPath = url.pathname.replace(
    /\/events\/[^/]+\/calendar-link$/,
    `/calendar/${encodeURIComponent(eventId)}`,
  );
  return json({
    icsUrl: `${url.origin}${calendarPath}?expires=${expires}&signature=${encodeURIComponent(signature)}`,
  });
}

async function calendarDownload(eventId: string, search: URLSearchParams) {
  const expires = Number(search.get("expires"));
  const signature = search.get("signature") ?? "";
  if (!await isCalendarTicketValid(eventId, expires, signature, calendarSigningSecret))
    throw Object.assign(new Error("Ссылка на календарь недействительна или устарела."), { status: 401 });

  const event = await loadFullEventRow(eventId);
  const final = await finalDetails(event);
  const eventUrl = eventDeepLink(botUsername, appShortName, event.id);
  const text = buildIcs({
    id: event.id,
    title: event.title,
    description: event.description || `Встреча в Flockly: ${eventUrl}`,
    location: [final.place, final.area].filter(Boolean).join(", "),
    url: eventUrl,
    startsAt: final.startsAt,
  });
  return new Response(text, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "attachment; filename=\"soberemsya.ics\"",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function groupLink(token: string, auth: AuthContext) {
  const { data, error } = await db.rpc("group_link_info", {
    p_token: parseGroupToken(token) ?? "",
    p_actor_user_id: auth.user.id,
  }).maybeSingle<{ chat_title: string; is_issuer: boolean }>();
  if (error) throw error;
  if (!data) throw groupLinkExpiredError();
  if (!data.is_issuer) throw groupLinkNotIssuerError();
  return json({ groupLink: { chatTitle: data.chat_title } });
}

// The meeting already exists here; a failed attachment is reported, not thrown.
async function attachEventToGroup(eventId: string, userId: string, token: string) {
  const { data, error } = await db.rpc("attach_event_to_group", {
    p_event_id: eventId,
    p_actor_user_id: userId,
    p_token: token,
  });
  if (error) {
    console.error("attach_event_to_group_rpc_failed", error.code);
    return false;
  }
  if (data !== "attached") console.warn("attach_event_to_group_rejected", data);
  return data === "attached";
}

async function finalDetails(event: FullEventRow) {
  if (event.status !== "decided" || !event.final_time_option_id || !event.final_place_id)
    throw Object.assign(new Error("Итог встречи ещё не выбран."), { status: 409 });
  const [{ data: time, error: timeError }, { data: place, error: placeError }] = await Promise.all([
    db.from("time_options").select("starts_at").eq("id", event.final_time_option_id).eq("event_id", event.id).maybeSingle(),
    db.from("place_options").select("title,area").eq("id", event.final_place_id).eq("event_id", event.id).maybeSingle(),
  ]);
  if (timeError || placeError) throw timeError ?? placeError;
  if (!time || !place)
    throw Object.assign(new Error("Итоговые данные встречи недоступны."), { status: 409 });
  return { startsAt: time.starts_at as string, place: place.title as string, area: place.area as string };
}

// Prepares a card that the Mini App sends with WebApp.shareMessage.
async function shareMessage(request: Request, eventId: string, auth: AuthContext) {
  const payload = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const kind = parseShareCardKind(payload.kind);
  const event = await loadFullEventRow(eventId);
  const participantExists = event.owner_user_id === auth.user.id
    ? false
    : await currentParticipantExists(eventId, auth.user.id);
  assertFullEventReadAccess({
    visibility: event.visibility,
    ownerUserId: event.owner_user_id,
    currentUserId: auth.user.id,
    participantExists,
  });
  if (event.status === "cancelled")
    throw Object.assign(new Error("Встреча отменена."), { status: 409 });
  const details = kind === "result" ? await finalDetails(event) : {};
  const url = eventDeepLink(botUsername, appShortName, event.id);
  const card = buildShareCard(
    kind,
    { title: event.title, description: event.description, ...details },
    url,
    crypto.randomUUID().replaceAll("-", ""),
    auth.language,
  );
  const response = await fetch(`https://api.telegram.org/bot${botToken}/savePreparedInlineMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: auth.user.telegram_user_id,
      result: card,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    }),
  }).catch(() => null);
  const body = await response?.json().catch(() => null) as { ok?: boolean; result?: { id?: string } } | null;
  if (!response?.ok || !body?.ok || typeof body.result?.id !== "string") {
    console.error("save_prepared_inline_message_failed", response?.status ?? 0);
    throw Object.assign(new Error("Не удалось подготовить карточку встречи."), { status: 502 });
  }
  return json({ preparedMessageId: body.result.id });
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Analytics never fails or delays a request: on Supabase the write finishes
// after the response (EdgeRuntime.waitUntil); errors are only logged.
function track(name: string, userId: string, eventId: string | null = null, source: string | null = null) {
  const work = (async () => {
    const { error } = await db.rpc("record_analytics_event", {
      p_name: name,
      p_user_id: userId,
      p_event_id: eventId,
      p_source: source,
    });
    if (error) console.error("record_analytics_event_failed", name, error.code);
  })();
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
    EdgeRuntime.waitUntil(work);
    return Promise.resolve();
  }
  return work;
}

async function clientAnalytics(request: Request, auth: AuthContext) {
  const event = parseClientAnalyticsEvent(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  await track(event.name, auth.user.id, event.eventId);
  return json({ ok: true });
}

// Hidden from everyone except administrators: others get a plain 404.
async function adminStats(auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const { data, error } = await db.rpc("admin_stats");
  if (error) throw error;
  return json({ stats: data });
}

// Stage 2.4 ---------------------------------------------------------------

// Only our own error tokens (P0001) are logged, never other database text.
function logModerationRpcError(name: string, error: { code?: string; message?: string }) {
  console.error(name, error.code, error.code === "P0001" ? error.message : "unknown");
}

async function reportEvent(request: Request, eventId: string, auth: AuthContext) {
  const input = parseReportInput(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  const { data, error } = await db.rpc("create_report", {
    p_actor_user_id: auth.user.id,
    p_event_id: eventId,
    p_participant_id: input.participantId,
    p_request_id: input.requestId,
    p_reason: input.reason,
    p_comment: input.comment,
    // The administrators get the report in the bot.
    p_admin_telegram_ids: [...adminIds].map(Number),
  }).single<{ report_id: string; outcome: "created" | "existing" }>();
  if (error) {
    logModerationRpcError("create_report_rpc_failed", error);
    throw moderationHttpError(error);
  }
  return json({ reported: true, alreadyReported: data?.outcome === "existing" }, data?.outcome === "created" ? 201 : 200);
}

async function blockFromEvent(request: Request, eventId: string, auth: AuthContext) {
  const target = parseModerationTarget(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  const { error } = await db.rpc("block_user", {
    p_actor_user_id: auth.user.id,
    p_event_id: eventId,
    p_participant_id: target.participantId,
    p_request_id: target.requestId,
  }).single<{ blocked_user_id: string; outcome: string }>();
  if (error) {
    logModerationRpcError("block_user_rpc_failed", error);
    throw moderationHttpError(error);
  }
  // The blocked person's id stays on the server: the open meeting preview
  // does not reveal who its organizer is.
  return json({ blocked: true });
}

async function blockedUsers(auth: AuthContext) {
  const { data, error } = await db.rpc("list_user_blocks", { p_actor_user_id: auth.user.id });
  if (error) throw error;
  return json(blockedUsersResponse((data ?? []) as BlockedUserRow[]));
}

async function unblock(userId: string, auth: AuthContext) {
  const { error } = await db.rpc("unblock_user", {
    p_actor_user_id: auth.user.id,
    p_blocked_user_id: parseUserId(userId),
  });
  if (error) throw error;
  return json({ unblocked: true });
}

async function acceptCommunityRules(auth: AuthContext) {
  const { error } = await db.rpc("accept_community_rules", { p_user_id: auth.user.id });
  if (error) throw error;
  return json({ communityRulesAccepted: true });
}

function isAdmin(auth: AuthContext) {
  return isAdminTelegramId(auth.user.telegram_user_id, adminIds);
}

const adminNotFound = () => json({ error: "Маршрут не найден." }, 404);

async function adminReports(request: Request, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const status = parseReportStatusFilter(new URL(request.url).searchParams.get("status"));
  const { data, error } = await db.rpc("admin_reports", { p_status: status, p_limit: 100 });
  if (error) throw error;
  return json({ reports: data ?? [] });
}

async function adminResolveReport(reportId: string, action: string, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const { data, error } = await db.rpc("admin_resolve_report", {
    p_admin_user_id: auth.user.id,
    p_report_id: parseReportId(reportId),
    p_status: parseReportResolution(action),
  }).single<{ status: string }>();
  if (error) {
    logModerationRpcError("admin_resolve_report_rpc_failed", error);
    throw moderationHttpError(error);
  }
  return json({ status: data?.status ?? null });
}

async function adminHideEvent(eventId: string, action: string, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const { data, error } = await db.rpc("admin_set_event_hidden", {
    p_admin_user_id: auth.user.id,
    p_event_id: eventId,
    p_hidden: action === "hide",
  }).single<{ hidden: boolean }>();
  if (error) {
    logModerationRpcError("admin_set_event_hidden_rpc_failed", error);
    throw moderationHttpError(error);
  }
  return json({ hidden: data?.hidden ?? false });
}

async function adminBanUser(userId: string, action: string, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const { data, error } = await db.rpc("admin_set_user_banned", {
    p_admin_user_id: auth.user.id,
    p_user_id: parseUserId(userId),
    p_banned: action === "ban",
  }).single<{ banned: boolean; hidden_events: number }>();
  if (error) {
    logModerationRpcError("admin_set_user_banned_rpc_failed", error);
    throw moderationHttpError(error);
  }
  return json({ banned: data?.banned ?? false, hiddenEvents: data?.hidden_events ?? 0 });
}

// Stage 2.3 ---------------------------------------------------------------

async function viewerCity(userId: string) {
  const [cities, cityId] = await Promise.all([loadCities(), loadUserCityId(userId)]);
  return resolveUserCity(cities, cityId);
}

type VenueQuery = {
  cityId: string;
  status: string;
  filters: VenueListFilters;
  /** People see only venues of active categories, curated picks first. */
  categoryIds?: string[];
  featuredFirst: boolean;
};

// One row more than a page tells whether another page exists. The curation
// list is ordered by name only: marking a pick must not move rows between
// pages the administrator is paging through.
async function venueRows({ cityId, status, filters, categoryIds, featuredFirst }: VenueQuery) {
  let query = db.from("venues").select(VENUE_COLUMNS).eq("city_id", cityId).eq("status", status);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (categoryIds) query = query.in("category_id", categoryIds);
  if (filters.search) query = query.ilike("name", titleSearchPattern(filters.search));
  if (filters.maxPriceLevel !== null)
    query = query.or(`price_level.is.null,price_level.lte.${filters.maxPriceLevel}`);
  if (featuredFirst) query = query.order("featured", { ascending: false });
  const { data, error } = await query
    .order("name")
    .order("id")
    .range(filters.offset, filters.offset + VENUE_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as unknown as VenueRow[];
  return { rows: rows.slice(0, VENUE_PAGE_SIZE), nextOffset: nextVenueOffset(filters.offset, rows.length) };
}

async function venues(request: Request, auth: AuthContext) {
  const filters = parseVenueListFilters(new URL(request.url).searchParams);
  const [city, categories] = await Promise.all([viewerCity(auth.user.id), loadCategories()]);
  const { rows, nextOffset } = await venueRows({
    cityId: city.id,
    status: "published",
    filters,
    categoryIds: categories.map((category) => category.id),
    featuredFirst: true,
  });
  return json({ items: rows.map(venueResponse), nextOffset, city: publicCity(city), categories });
}

async function venueById(venueId: string) {
  const id = parseVenueId(venueId);
  const { data, error } = await db.from("venues").select(VENUE_COLUMNS)
    .eq("id", id).eq("status", "published").maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Место не найдено."), { status: 404 });
  return json({ venue: venueResponse(data as unknown as VenueRow) });
}

// Stage 4: points of the viewer's city for the map in «Места».
async function mapPoints(request: Request, auth: AuthContext) {
  const categoryId = parseCategoryId(new URL(request.url).searchParams.get("category"));
  const [city, categories] = await Promise.all([viewerCity(auth.user.id), loadCategories()]);
  const { data, error } = await db.rpc("public_map_points", {
    p_viewer_user_id: auth.user.id,
    p_city_id: city.id,
    p_category_id: categoryId,
    p_category_ids: categories.map((category) => category.id),
  });
  if (error) throw error;
  return json({
    ...mapPointsFromRpc(data),
    city: publicCity(city),
    bounds: cityMapBounds(city.id),
    categories,
  });
}

// The city chosen in «Каталог мест», open or not; cities are read fresh so a
// city opened a moment ago shows as open. Other isolates of the function may
// see the change up to REFERENCE_DATA_TTL_MS later.
async function adminRequestedCity(auth: AuthContext, requestedCityId: unknown) {
  const cities = await loadCities.fresh();
  const ownCity = requestedCityId ? null : resolveUserCity(cities, await loadUserCityId(auth.user.id));
  return { city: ownCity ?? adminCity(cities, requestedCityId, resolveUserCity(cities, null)), cities };
}

// Opens a city once its catalog is filled, or closes it again.
async function adminSetCityActive(request: Request, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const { cityId, isActive } = parseCityActive(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  const { error } = await db.rpc("admin_set_city_active", { p_city_id: cityId, p_is_active: isActive });
  if (error) {
    logModerationRpcError("admin_set_city_active_rpc_failed", error);
    throw cityHttpError(error);
  }
  const cities = await loadCities.fresh();
  console.log("admin_city_active", cityId, isActive);
  return json({ cities: cities.map(adminCityResponse) });
}

async function adminVenues(request: Request, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  if (request.method === "POST") return await adminCreateVenue(request, auth);
  const params = new URL(request.url).searchParams;
  const status = parseVenueStatus(params.get("status") ?? "pending");
  const filters = parseVenueListFilters(params);
  const [{ city, cities }, categories] = await Promise.all([
    adminRequestedCity(auth, params.get("cityId")),
    loadCategories(),
  ]);
  const { rows, nextOffset } = await venueRows({ cityId: city.id, status, filters, featuredFirst: false });
  return json({
    items: rows.map(adminVenueResponse),
    nextOffset,
    city: adminCityResponse(city),
    cities: cities.map(adminCityResponse),
    categories,
    importCategories: osmImportCategories(),
    overpass: overpassClientSource(city.id),
  });
}

async function adminCreateVenue(request: Request, auth: AuthContext) {
  const body = await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES);
  const input = parseVenueCreate(body);
  const { city } = await adminRequestedCity(auth, body.cityId);
  const { data, error } = await db.rpc("admin_create_venue", {
    p_admin_user_id: auth.user.id,
    p_city_id: city.id,
    p_category_id: input.categoryId,
    p_name: input.name,
    p_address: input.address,
    p_price_level: input.priceLevel,
    p_website: input.website,
  }).single<{ venue_id: string }>();
  if (error) {
    logModerationRpcError("admin_create_venue_rpc_failed", error);
    throw venueHttpError(error);
  }
  return json({ venueId: data?.venue_id ?? null }, 201);
}

async function adminUpdateVenue(request: Request, venueId: string, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const id = parseVenueId(venueId);
  const update = parseVenueUpdate(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  const { error } = await db.rpc("admin_update_venue", {
    p_admin_user_id: auth.user.id,
    p_venue_id: id,
    p_status: update.status,
    p_category_id: update.categoryId,
    p_price_level: update.priceLevel,
    p_featured: update.featured,
  }).single<{ venue_id: string }>();
  if (error) {
    logModerationRpcError("admin_update_venue_rpc_failed", error);
    throw venueHttpError(error);
  }
  return json({ updated: true });
}

async function adminPublishVenues(request: Request, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  const ids = parseVenueIds(await readJsonObject(request, API_JSON_BODY_LIMIT_BYTES));
  const { data, error } = await db.rpc("admin_publish_venues", {
    p_admin_user_id: auth.user.id,
    p_venue_ids: ids,
  }).single<{ published: number }>();
  if (error) {
    logModerationRpcError("admin_publish_venues_rpc_failed", error);
    throw venueHttpError(error);
  }
  return json({ published: data?.published ?? 0 });
}

// `expose`: the message is safe and useful for the administrator, so errorResponse keeps it despite the 503.
const osmUnavailable = () =>
  Object.assign(new Error("OpenStreetMap сейчас не отвечает. Попробуйте через несколько минут."), { status: 503, expose: true });

async function fetchOverpassFrom(url: string, query: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": `Flockly/1.0 (+https://t.me/${botUsername}; Telegram Mini App, venue catalog import)`,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (error) {
    console.error("overpass_request_failed", new URL(url).hostname, error instanceof Error ? error.name : "unknown");
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    console.error("overpass_status", new URL(url).hostname, response.status);
    return null;
  }
  let answer: unknown;
  try {
    answer = await readBoundedJson(response, OVERPASS_MAX_RESPONSE_BYTES);
  } catch (error) {
    console.error("overpass_body_failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
  if (overpassFailed(answer)) {
    console.error("overpass_remark", new URL(url).hostname);
    return null;
  }
  return answer;
}

async function fetchOverpass(query: string) {
  for (const url of OVERPASS_URLS) {
    const answer = await fetchOverpassFrom(url, query);
    if (answer) return answer;
  }
  throw osmUnavailable();
}

// Imports one category of the administrator's city: new venues wait for
// curation, known ones get fresh OSM fields.
async function adminImportVenues(request: Request, auth: AuthContext) {
  if (!isAdmin(auth)) return adminNotFound();
  // Only an administrator gets this far, so only they may upload a large answer.
  const body = await readJsonObject(request, OSM_IMPORT_BODY_LIMIT_BYTES);
  const [{ city }, categories] = await Promise.all([adminRequestedCity(auth, body.cityId), loadCategories()]);
  const { categoryId } = parseOsmImportRequest(body, city.id);
  if (!categoryById(categories, categoryId)) throw venueHttpError({ code: "P0001", message: "VENUE_CATEGORY_INVALID" });
  // The app sends what it got from Overpass; an older app leaves it to the server.
  const elements = parseOsmClientElements(body.elements);
  const answer = elements ? { elements } : await fetchOverpass(overpassQuery(city.id, categoryId));
  const items = venuesFromOverpass(answer, categoryId);
  let inserted = 0;
  let updated = 0;
  for (const part of chunk(items, 500)) {
    const { data, error } = await db.rpc("admin_import_venues", { p_city_id: city.id, p_items: part })
      .single<{ inserted: number; updated: number }>();
    if (error) {
      logModerationRpcError("admin_import_venues_rpc_failed", error);
      throw venueHttpError(error);
    }
    inserted += data?.inserted ?? 0;
    updated += data?.updated ?? 0;
  }
  return json({ found: items.length, inserted, updated, truncated: overpassTruncated(answer) });
}

function apiPath(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const functionIndex = segments.lastIndexOf("telegram-api");
  return `/${segments.slice(functionIndex + 1).join("/")}`;
}

function allowedMethods(path: string) {
  if (path === "/health" || /^\/calendar\/[^/]+$/.test(path)) return ["GET"];
  if (path === "/telegram/auth" || path === "/events") return ["POST"];
  if (path === "/me/meetings" || path === "/me/meetings/page" || path === "/public/events") return ["GET"];
  if (path === "/me/notification-settings") return ["GET", "PUT"];
  if (path === "/me/city") return ["GET", "PUT"];
  if (path === "/me/language") return ["PUT"];
  if (path === "/categories") return ["GET"];
  if (path === "/me/analytics") return ["POST"];
  if (path === "/admin/stats") return ["GET"];
  if (path === "/admin/reports") return ["GET"];
  if (/^\/admin\/reports\/[^/]+\/(resolve|dismiss)$/.test(path)) return ["POST"];
  if (/^\/admin\/events\/[^/]+\/(hide|unhide)$/.test(path)) return ["POST"];
  if (/^\/admin\/users\/[^/]+\/(ban|unban)$/.test(path)) return ["POST"];
  if (path === "/venues" || path === "/map") return ["GET"];
  if (/^\/venues\/[^/]+$/.test(path)) return ["GET"];
  if (path === "/admin/venues") return ["GET", "POST"];
  if (path === "/admin/venues/import" || path === "/admin/venues/publish") return ["POST"];
  if (path === "/admin/cities/active") return ["POST"];
  if (/^\/admin\/venues\/[^/]+$/.test(path)) return ["PATCH"];
  if (path === "/me/blocks") return ["GET"];
  if (/^\/me\/blocks\/[^/]+$/.test(path)) return ["DELETE"];
  if (path === "/me/community-rules") return ["POST"];
  if (/^\/events\/[^/]+\/(report|block)$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/response$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/(time-options|place-options)\/proposals$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/participation$/.test(path)) return ["DELETE"];
  if (/^\/events\/[^/]+\/participants\/[^/]+$/.test(path)) return ["DELETE"];
  if (/^\/events\/[^/]+\/calendar-link$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/share-message$/.test(path)) return ["POST"];
  if (/^\/group-links\/[^/]+$/.test(path)) return ["GET"];
  if (/^\/events\/[^/]+\/join-request$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/join-requests$/.test(path)) return ["GET"];
  if (/^\/events\/[^/]+\/join-requests\/[^/]+\/(approve|reject)$/.test(path)) return ["POST"];
  if (/^\/events\/[^/]+\/manage$/.test(path)) return ["PATCH", "DELETE"];
  if (/^\/events\/[^/]+\/preview$/.test(path)) return ["GET"];
  if (/^\/events\/[^/]+$/.test(path)) return ["GET"];
  return null;
}

function isBrowserApiPath(path: string) {
  return path !== "/health" && !/^\/calendar\/[^/]+$/.test(path);
}

function methodNotAllowed(methods: string[]) {
  return json(
    { error: "Метод не поддерживается." },
    405,
    { allow: methods.join(", ") },
  );
}

async function handleApiRequest(request: Request, url: URL, path: string) {
  if (path === "/health") return await health();
  const calendarMatch = path.match(/^\/calendar\/([^/]+)$/);
  if (calendarMatch)
    return await calendarDownload(
      decodeURIComponent(calendarMatch[1]),
      url.searchParams,
    );
  if (path === "/telegram/auth") {
    const body = await readJsonObject(request, TELEGRAM_AUTH_BODY_LIMIT_BYTES);
    const auth = await authenticate(request, String(body.initData ?? ""));
    const start = parseStartParam(auth.startParam);
    await track("app_open", auth.user.id, start?.type === "event" ? start.eventId : null, startParamSource(auth.startParam));
    return json({
      isAdmin: isAdminTelegramId(auth.user.telegram_user_id, adminIds),
      user: {
        id: auth.user.id,
        telegramUserId: auth.user.telegram_user_id,
        username: auth.user.username,
        firstName: auth.user.first_name,
        lastName: auth.user.last_name,
        photoUrl: auth.user.photo_url,
      },
      startParam: auth.startParam,
      // null: «as in Telegram» (or not chosen yet).
      language: await storedLanguage(auth.user.id),
    });
  }

  const auth = await authenticate(request);
  if (path === "/events") return await createEvent(request, auth);
  if (path === "/me/meetings") return await meetings(auth);
  if (path === "/me/meetings/page") return await meetingListPage(request, auth);
  if (path === "/me/notification-settings") return await notificationSettings(request, auth);
  if (path === "/me/city") return await userCity(request, auth);
  if (path === "/me/language") return await userLanguagePreference(request, auth);
  if (path === "/categories") return json({ categories: await loadCategories() });
  if (path === "/me/analytics") return await clientAnalytics(request, auth);
  if (path === "/admin/stats") return await adminStats(auth);
  if (path === "/public/events") return await publicEvents(request, auth);
  if (path === "/admin/reports") return await adminReports(request, auth);
  if (path === "/venues") return await venues(request, auth);
  if (path === "/map") return await mapPoints(request, auth);
  const venueMatch = path.match(/^\/venues\/([^/]+)$/);
  if (venueMatch) return await venueById(decodeURIComponent(venueMatch[1]));
  if (path === "/admin/venues") return await adminVenues(request, auth);
  if (path === "/admin/venues/import") return await adminImportVenues(request, auth);
  if (path === "/admin/venues/publish") return await adminPublishVenues(request, auth);
  if (path === "/admin/cities/active") return await adminSetCityActive(request, auth);
  const adminVenueMatch = path.match(/^\/admin\/venues\/([^/]+)$/);
  if (adminVenueMatch) return await adminUpdateVenue(request, decodeURIComponent(adminVenueMatch[1]), auth);
  if (path === "/me/blocks") return await blockedUsers(auth);
  if (path === "/me/community-rules") return await acceptCommunityRules(auth);
  const unblockMatch = path.match(/^\/me\/blocks\/([^/]+)$/);
  if (unblockMatch) return await unblock(decodeURIComponent(unblockMatch[1]), auth);
  const adminReportMatch = path.match(/^\/admin\/reports\/([^/]+)\/(resolve|dismiss)$/);
  if (adminReportMatch)
    return await adminResolveReport(decodeURIComponent(adminReportMatch[1]), adminReportMatch[2], auth);
  const adminEventMatch = path.match(/^\/admin\/events\/([^/]+)\/(hide|unhide)$/);
  if (adminEventMatch)
    return await adminHideEvent(decodeURIComponent(adminEventMatch[1]), adminEventMatch[2], auth);
  const adminUserMatch = path.match(/^\/admin\/users\/([^/]+)\/(ban|unban)$/);
  if (adminUserMatch)
    return await adminBanUser(decodeURIComponent(adminUserMatch[1]), adminUserMatch[2], auth);
  const reportMatch = path.match(/^\/events\/([^/]+)\/report$/);
  if (reportMatch) return await reportEvent(request, decodeURIComponent(reportMatch[1]), auth);
  const blockMatch = path.match(/^\/events\/([^/]+)\/block$/);
  if (blockMatch) return await blockFromEvent(request, decodeURIComponent(blockMatch[1]), auth);
  const responseMatch = path.match(/^\/events\/([^/]+)\/response$/);
  if (responseMatch)
    return await saveResponse(request, decodeURIComponent(responseMatch[1]), auth);
  const timeProposalMatch = path.match(/^\/events\/([^/]+)\/time-options\/proposals$/);
  if (timeProposalMatch)
    return await proposeTimeOption(request, decodeURIComponent(timeProposalMatch[1]), auth);
  const placeProposalMatch = path.match(/^\/events\/([^/]+)\/place-options\/proposals$/);
  if (placeProposalMatch)
    return await proposePlaceOption(request, decodeURIComponent(placeProposalMatch[1]), auth);
  const participationMatch = path.match(/^\/events\/([^/]+)\/participation$/);
  if (participationMatch)
    return await leaveParticipation(decodeURIComponent(participationMatch[1]), auth);
  const organizerParticipantMatch = path.match(/^\/events\/([^/]+)\/participants\/([^/]+)$/);
  if (organizerParticipantMatch)
    return await removeEventParticipant(
      decodeURIComponent(organizerParticipantMatch[1]),
      decodeURIComponent(organizerParticipantMatch[2]),
      auth,
    );
  const shareMessageMatch = path.match(/^\/events\/([^/]+)\/share-message$/);
  if (shareMessageMatch)
    return await shareMessage(request, decodeURIComponent(shareMessageMatch[1]), auth);
  const groupLinkMatch = path.match(/^\/group-links\/([^/]+)$/);
  if (groupLinkMatch) return await groupLink(decodeURIComponent(groupLinkMatch[1]), auth);
  const calendarLinkMatch = path.match(/^\/events\/([^/]+)\/calendar-link$/);
  if (calendarLinkMatch)
    return await calendarLink(request, decodeURIComponent(calendarLinkMatch[1]), auth);
  const joinRequestMatch = path.match(/^\/events\/([^/]+)\/join-request$/);
  if (joinRequestMatch)
    return await createJoinRequest(decodeURIComponent(joinRequestMatch[1]), auth);
  const organizerJoinRequestsMatch = path.match(/^\/events\/([^/]+)\/join-requests$/);
  if (organizerJoinRequestsMatch)
    return await organizerJoinRequests(
      decodeURIComponent(organizerJoinRequestsMatch[1]),
      auth,
    );
  const joinRequestDecisionMatch = path.match(/^\/events\/([^/]+)\/join-requests\/([^/]+)\/(approve|reject)$/);
  if (joinRequestDecisionMatch)
    return await decideJoinRequest(
      joinRequestDecisionMatch[3] as JoinRequestDecisionAction,
      decodeURIComponent(joinRequestDecisionMatch[1]),
      decodeURIComponent(joinRequestDecisionMatch[2]),
      auth,
    );
  const manageMatch = path.match(/^\/events\/([^/]+)\/manage$/);
  if (manageMatch)
    return await manageEvent(request, decodeURIComponent(manageMatch[1]), auth);
  const previewMatch = path.match(/^\/events\/([^/]+)\/preview$/);
  if (previewMatch)
    return json({
      preview: await publicEventPreview(decodeURIComponent(previewMatch[1]), auth.user.id, auth.language),
    });
  const eventMatch = path.match(/^\/events\/([^/]+)$/);
  if (eventMatch)
    return json({
      event: await fullEventForRequest(decodeURIComponent(eventMatch[1]), auth.user.id),
    });
  return json({ error: "Маршрут не найден." }, 404);
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = apiPath(url);
  const methods = allowedMethods(path);
  const browserApi = isBrowserApiPath(path);

  if (request.method === "OPTIONS") {
    if (!methods) {
      const response = json({ error: "Маршрут не найден." }, 404);
      return browserApi ? withBrowserCors(request, response) : response;
    }
    if (!browserApi) return methodNotAllowed(methods ?? []);
    return browserPreflightResponse(request);
  }
  if (methods && !methods.includes(request.method)) {
    const response = methodNotAllowed(methods);
    return browserApi ? withBrowserCors(request, response) : response;
  }

  try {
    const response = await handleApiRequest(request, url, path);
    return browserApi ? withBrowserCors(request, response) : response;
  } catch (error) {
    const response = errorResponse(error);
    return browserApi ? withBrowserCors(request, response) : response;
  }
});
