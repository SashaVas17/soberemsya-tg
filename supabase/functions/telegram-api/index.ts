import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { buildIcs, isCalendarTicketValid, signCalendarTicket } from "../_shared/calendar.ts";
import { assertEventAvailable, assertFullEventReadAccess, assertOwner, assertVotingOpen, authorizeParticipantResponse, parseEventStartParam, type Status } from "../_shared/domain.ts";
import { organizerEventPayload, participantEventPayload, privateInviteEventPayload, resolveEventViewerRole, type EventViewerRole } from "../_shared/event-payload.ts";
import { corsHeaders, errorResponse, json } from "../_shared/http.ts";
import { meetingListItem } from "../_shared/meeting-list.ts";
import { collectVisibleMeetings } from "../_shared/meetings.ts";
import { buildPublicEventPreview } from "../_shared/public-preview.ts";
import { buildPublicFeedItem, encodePublicFeedCursor, parsePublicFeedCursor, parsePublicFeedLimit, type PublicFeedEvent } from "../_shared/public-feed.ts";
import { validateTelegramInitData } from "../_shared/telegram.ts";
import { parseCreateMeetingMode } from "../_shared/open-meetings.ts";
import { createJoinRequestErrorToken, createJoinRequestHttpError, createJoinRequestHttpResult, type CreateJoinRequestRow } from "../_shared/join-request.ts";
import { joinRequestDecisionErrorToken, joinRequestDecisionHttpError, joinRequestDecisionResponse, organizerJoinRequestsResponse, resolveJoinRequestDecisionRetry, type JoinRequestDecisionAction, type JoinRequestListRow, type RequesterProfileRow } from "../_shared/organizer-join-requests.ts";
import { leaveParticipationErrorToken, leaveParticipationHttpError } from "../_shared/leave-participation.ts";

type Db = ReturnType<typeof createClient>;
type AppUser = { id: string; telegram_user_id: string; username: string | null; first_name: string; last_name: string | null; photo_url: string | null };
type AuthContext = { user: AppUser; startParam: string | null };
type FullEventRow = { id: string; owner_user_id: string | null; title: string; description: string; budget_limit: number; visibility: string | null; max_participants: number | null; status: Status; final_place_id: string | null; final_time_option_id: string | null; created_at: string; deleted_at: string | null };
type PreviewEventRow = Pick<FullEventRow, "id" | "owner_user_id" | "title" | "description" | "budget_limit" | "visibility" | "max_participants" | "status" | "deleted_at">;
type PublicFeedEventRow = Pick<FullEventRow, "id" | "owner_user_id" | "title" | "description" | "budget_limit" | "max_participants" | "status" | "created_at">;
type OrganizerEventRow = Pick<FullEventRow, "owner_user_id" | "visibility">;
type JoinRequestDecisionRpcRow = { request_id: string; participant_id?: string };
type JoinRequestStateRow = { status: string; requester_user_id: string };
type LeaveParticipationRow = { event_id: string };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = (Deno.env.get("TELEGRAM_DB_SECRET_KEY") ?? "").trim();
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const calendarSigningSecret = Deno.env.get("TELEGRAM_CALENDAR_SIGNING_SECRET") ?? "";
// New-format secret keys must reach the REST API only in the apikey header.
const adminFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("apikey", serviceKey);
  headers.delete("Authorization");
  return fetch(input, { ...init, headers });
};
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: adminFetch },
});

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`; }

async function authenticate(request: Request, bodyInitData?: string): Promise<AuthContext> {
  const raw = bodyInitData ?? request.headers.get("x-telegram-init-data") ?? "";
  let validated;
  try {
    validated = await validateTelegramInitData(raw, botToken, { maxAgeSeconds: 3600 });
  } catch (error) {
    console.error("telegram_auth_validation_failed", error instanceof Error ? error.message : "unknown");
    throw Object.assign(new Error("Не удалось подтвердить данные Telegram. Откройте Mini App заново."), { status: 401 });
  }
  const profile = validated.user;
  const { data, error } = await db.from("users").upsert({ telegram_user_id: String(profile.id), username: profile.username ?? null, first_name: profile.first_name, last_name: profile.last_name ?? null, language_code: profile.language_code ?? null, photo_url: profile.photo_url ?? null, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" }).select("id,telegram_user_id,username,first_name,last_name,photo_url").single<AppUser>();
  if (error) {
    console.error("telegram_user_upsert_failed", error.code);
    throw Object.assign(new Error("Не удалось сохранить пользователя Telegram."), { status: 503 });
  }
  return { user: data, startParam: validated.startParam };
}

async function health() {
  const databaseSecretPresent = Boolean(serviceKey);
  const databaseSecretLooksValid = serviceKey.startsWith("sb_secret_");
  if (!botToken || !serviceKey || !supabaseUrl)
    return json({ status: "error", telegramConfigured: Boolean(botToken), databaseConfigured: Boolean(serviceKey && supabaseUrl), databaseSecretPresent, databaseSecretLooksValid }, 503);
  const { error } = await db.from("users").select("id").limit(1);
  return error
    ? json({ status: "error", telegramConfigured: true, databaseConfigured: false, databaseSecretPresent, databaseSecretLooksValid, databaseCode: error.code }, 503)
    : json({ status: "ok", telegramConfigured: true, databaseConfigured: true, databaseSecretPresent, databaseSecretLooksValid });
}

async function loadFullEventRow(eventId: string) {
  const { data: event, error } = await db.from("events").select("id,owner_user_id,title,description,budget_limit,visibility,max_participants,status,final_place_id,final_time_option_id,created_at,deleted_at").eq("id", eventId).is("deleted_at", null).maybeSingle<FullEventRow>();
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
  const [{ data: times, error: timeError }, { data: places, error: placeError }, { data: people, error: peopleError }] = await Promise.all([
    db.from("time_options").select("id,starts_at").eq("event_id", eventId).order("starts_at"),
    db.from("place_options").select("id,title,area,estimated_budget").eq("event_id", eventId),
    db.from("participants").select("id,user_id,name,area,budget,preferences,restrictions").eq("event_id", eventId).order("created_at"),
  ]);
  if (timeError || placeError || peopleError) throw timeError ?? placeError ?? peopleError;
  const participantIds = (people ?? []).map((person) => person.id);
  const { data: votes, error: voteError } = participantIds.length ? await db.from("availability_votes").select("participant_id,time_option_id,is_available").in("participant_id", participantIds) : { data: [], error: null };
  if (voteError) throw voteError;
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
    currentUserId: userId,
  };
  if (role === "owner") return organizerEventPayload(source);
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

async function publicEventPreview(eventId: string, userId: string) {
  const { data: event, error } = await db.from("events").select("id,owner_user_id,title,description,budget_limit,visibility,max_participants,status,deleted_at").eq("id", eventId).is("deleted_at", null).maybeSingle<PreviewEventRow>();
  if (error) throw error;
  assertEventAvailable(event);
  if (event.visibility !== "public")
    throw Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 });

  const [{ data: times, error: timeError }, { data: people, error: peopleError }] = await Promise.all([
    db.from("time_options").select("starts_at").eq("event_id", eventId),
    db.from("participants").select("user_id").eq("event_id", eventId),
  ]);
  if (timeError || peopleError) throw timeError ?? peopleError;
  const participantUserIds = (people ?? []).map((person) => person.user_id as string | null);
  const participantExists = participantUserIds.includes(userId);
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
  });
}

async function createEvent(request: Request, auth: AuthContext) {
  const payload = await request.json();
  const title = String(payload.title ?? "").trim();
  const { visibility, maxParticipants } = parseCreateMeetingMode(payload);
  const times = [...new Set((payload.timeOptions ?? []).map(String).filter((value: string) => !Number.isNaN(Date.parse(value))))].sort() as string[];
  if (!title) throw Object.assign(new Error("Укажите название встречи."), { status: 400 });
  if (!times.length) throw Object.assign(new Error("Добавьте хотя бы один вариант даты и времени."), { status: 400 });
  const eventId = id("evt");
  const { error } = await db.from("events").insert({ id: eventId, admin_token: id("backup"), owner_user_id: auth.user.id, title, description: String(payload.description ?? "").trim(), budget_limit: Math.max(0, Number(payload.budgetLimit) || 0), visibility, max_participants: maxParticipants });
  if (error) throw error;
  const { error: timeError } = await db.from("time_options").insert(times.map((startsAt) => ({ id: id("time"), event_id: eventId, starts_at: startsAt })));
  if (timeError) throw timeError;
  const places = (payload.placeOptions ?? []).filter((place: { title?: string }) => place.title?.trim()).map((place: { title: string; area?: string; estimatedBudget?: number }) => ({ id: id("place"), event_id: eventId, title: place.title.trim(), area: String(place.area ?? "").trim(), estimated_budget: Math.max(0, Number(place.estimatedBudget) || 0) }));
  if (places.length) { const { error: placeError } = await db.from("place_options").insert(places); if (placeError) throw placeError; }
  return json({ event: await eventPayload(eventId, auth.user.id) }, 201);
}

async function createJoinRequest(eventId: string, auth: AuthContext) {
  const { data, error } = await db.rpc("create_join_request", {
    p_event_id: eventId,
    p_requester_user_id: auth.user.id,
  }).single<CreateJoinRequestRow>();
  if (error) {
    console.error(
      "create_join_request_rpc_failed",
      error.code,
      createJoinRequestErrorToken(error) ?? "unknown",
    );
    throw createJoinRequestHttpError(error);
  }
  const result = createJoinRequestHttpResult(data);
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
  const payload = await request.json();
  const { data: event, error } = await db.from("events").select("status,visibility,owner_user_id").eq("id", eventId).is("deleted_at", null).maybeSingle();
  if (error) throw error; if (!event) throw Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 }); assertVotingOpen(event.status);
  const { data: existing, error: existingError } = await db.from("participants").select("id").eq("event_id", eventId).eq("user_id", auth.user.id).maybeSingle(); if (existingError) throw existingError;
  const authorization = authorizeParticipantResponse({ visibility: event.visibility, ownerUserId: event.owner_user_id, currentUserId: auth.user.id, participantId: existing?.id ?? null });
  const { data: options, error: optionsError } = await db.from("time_options").select("id").eq("event_id", eventId); if (optionsError) throw optionsError;
  const validIds = new Set((options ?? []).map((option) => option.id)); const availableIds = [...new Set((payload.availableTimeOptionIds ?? []).map(String))] as string[];
  if (availableIds.some((optionId) => !validIds.has(optionId))) throw Object.assign(new Error("Один из вариантов времени больше недоступен."), { status: 400 });
  const name = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(" ");
  const values = { name, area: String(payload.area ?? "").trim(), budget: Math.max(0, Number(payload.budget) || 0), preferences: String(payload.preferences ?? "").trim(), restrictions: String(payload.restrictions ?? "").trim() };
  const participantId = existing?.id ?? crypto.randomUUID();
  const participantError = authorization === "update" ? (await db.from("participants").update(values).eq("event_id", eventId).eq("user_id", auth.user.id)).error : (await db.from("participants").insert({ id: participantId, event_id: eventId, user_id: auth.user.id, edit_token: crypto.randomUUID(), ...values })).error;
  if (participantError) throw participantError;
  const { error: deleteError } = await db.from("availability_votes").delete().eq("participant_id", participantId); if (deleteError) throw deleteError;
  const rows = (options ?? []).map((option) => ({ participant_id: participantId, time_option_id: option.id, is_available: availableIds.includes(option.id) }));
  if (rows.length) { const { error: voteError } = await db.from("availability_votes").insert(rows); if (voteError) throw voteError; }
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

async function manageEvent(request: Request, eventId: string, auth: AuthContext) {
  const { data: event, error } = await db.from("events").select("owner_user_id,status").eq("id", eventId).is("deleted_at", null).maybeSingle(); if (error) throw error; if (!event) throw Object.assign(new Error("Встреча не найдена."), { status: 404 }); assertOwner(event.owner_user_id, auth.user.id);
  if (request.method === "DELETE") { const { error: deleteError } = await db.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", eventId).eq("owner_user_id", auth.user.id); if (deleteError) throw deleteError; return json({ deleted: true }); }
  const payload = await request.json();
  switch (payload.action) {
    case "update_details": { const title = String(payload.title ?? "").trim(); if (!title) throw Object.assign(new Error("Название не может быть пустым."), { status: 400 }); const { error: updateError } = await db.from("events").update({ title, description: String(payload.description ?? "").trim() }).eq("id", eventId); if (updateError) throw updateError; break; }
    case "add_time": { const startsAt = String(payload.startsAt ?? ""); if (Number.isNaN(Date.parse(startsAt))) throw Object.assign(new Error("Некорректная дата."), { status: 400 }); const { error: insertError } = await db.from("time_options").insert({ id: id("time"), event_id: eventId, starts_at: startsAt }); if (insertError) throw insertError; break; }
    case "remove_time": { const optionId = String(payload.timeOptionId ?? ""); const { error: deleteError } = await db.from("time_options").delete().eq("id", optionId).eq("event_id", eventId); if (deleteError) throw deleteError; break; }
    case "add_place": { const place = payload.place ?? {}; const title = String(place.title ?? "").trim(); if (!title) throw Object.assign(new Error("Укажите место."), { status: 400 }); const { error: insertError } = await db.from("place_options").insert({ id: id("place"), event_id: eventId, title, area: String(place.area ?? "").trim(), estimated_budget: Math.max(0, Number(place.estimatedBudget) || 0) }); if (insertError) throw insertError; break; }
    case "remove_place": { const { error: deleteError } = await db.from("place_options").delete().eq("id", String(payload.placeOptionId ?? "")).eq("event_id", eventId); if (deleteError) throw deleteError; break; }
    case "close": { const { error: updateError } = await db.from("events").update({ status: "place_selection" }).eq("id", eventId); if (updateError) throw updateError; break; }
    case "reopen": { const { error: updateError } = await db.from("events").update({ status: "collecting", final_time_option_id: null, final_place_id: null }).eq("id", eventId); if (updateError) throw updateError; break; }
    case "decide": { const timeId = String(payload.finalTimeOptionId ?? ""); const placeId = String(payload.finalPlaceId ?? ""); const [{ data: time }, { data: place }] = await Promise.all([db.from("time_options").select("id").eq("id", timeId).eq("event_id", eventId).maybeSingle(), db.from("place_options").select("id").eq("id", placeId).eq("event_id", eventId).maybeSingle()]); if (!time || !place) throw Object.assign(new Error("Выберите допустимые время и место."), { status: 400 }); const { error: updateError } = await db.from("events").update({ status: "decided", final_time_option_id: timeId, final_place_id: placeId }).eq("id", eventId); if (updateError) throw updateError; break; }
    default: throw Object.assign(new Error("Неизвестное действие."), { status: 400 });
  }
  return json({ event: await eventPayload(eventId, auth.user.id) });
}

async function meetings(auth: AuthContext) {
  const [{ data: owned, error: ownedError }, { data: participations, error: participationError }] = await Promise.all([db.from("events").select("id").eq("owner_user_id", auth.user.id).is("deleted_at", null).order("created_at", { ascending: false }), db.from("participants").select("event_id").eq("user_id", auth.user.id)]);
  if (ownedError || participationError) throw ownedError ?? participationError;
  const ownedIds = (owned ?? []).map((item) => item.id); const participatingIds = [...new Set((participations ?? []).map((item) => item.event_id))].filter((eventId) => !ownedIds.includes(eventId));
  const mapItem = async (eventId: string, role: "owner" | "participant") =>
    meetingListItem(await eventPayload(eventId, auth.user.id), role);
  return json(await collectVisibleMeetings(ownedIds, participatingIds, mapItem));
}

async function publicEvents(request: Request, auth: AuthContext) {
  void auth;
  const url = new URL(request.url);
  const limit = parsePublicFeedLimit(url.searchParams.get("limit"));
  const cursor = parsePublicFeedCursor(url.searchParams.get("cursor"));
  let eventQuery = db
    .from("events")
    .select("id,owner_user_id,title,description,budget_limit,max_participants,status,created_at")
    .eq("visibility", "public")
    .is("deleted_at", null)
    .eq("status", "collecting")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor)
    eventQuery = eventQuery.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  const { data, error } = await eventQuery;
  if (error) throw error;
  const page = ((data ?? []) as PublicFeedEventRow[]).slice(0, limit);
  const eventIds = page.map((event) => event.id);
  const hasNextPage = (data ?? []).length > limit;
  if (!eventIds.length) return json({ items: [], nextCursor: null });

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
      }),
    ),
    nextCursor:
      hasNextPage && lastEvent
        ? encodePublicFeedCursor({
            createdAt: lastEvent.created_at,
            id: lastEvent.id,
          })
        : null,
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
  if (event.status !== "decided" || !event.final_time_option_id || !event.final_place_id)
    throw Object.assign(new Error("Итог встречи ещё не выбран."), { status: 409 });

  const [{ data: time, error: timeError }, { data: place, error: placeError }] = await Promise.all([
    db.from("time_options").select("starts_at").eq("id", event.final_time_option_id).eq("event_id", eventId).maybeSingle(),
    db.from("place_options").select("title,area").eq("id", event.final_place_id).eq("event_id", eventId).maybeSingle(),
  ]);
  if (timeError || placeError) throw timeError ?? placeError;
  if (!time || !place)
    throw Object.assign(new Error("Итоговые данные встречи недоступны."), { status: 409 });

  const bot = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "soberemsyabelarusbot";
  const app = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "soberemsya";
  const eventUrl = `https://t.me/${bot}/${app}?startapp=event_${event.id}`;
  const text = buildIcs({
    id: event.id,
    title: event.title,
    description: event.description || `Встреча в «Соберёмся»: ${eventUrl}`,
    location: [place.title, place.area].filter(Boolean).join(", "),
    url: eventUrl,
    startsAt: time.starts_at,
  });
  return new Response(text, {
    headers: {
      ...corsHeaders,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "attachment; filename=\"soberemsya.ics\"",
      "cache-control": "private, no-store",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(request.url); const segments = url.pathname.split("/").filter(Boolean); const functionIndex = segments.lastIndexOf("telegram-api"); const path = `/${segments.slice(functionIndex + 1).join("/")}`;
    if (path === "/health" && request.method === "GET") return await health();
    const calendarMatch = path.match(/^\/calendar\/([^/]+)$/); if (calendarMatch && request.method === "GET") return await calendarDownload(decodeURIComponent(calendarMatch[1]), url.searchParams);
    if (path === "/telegram/auth" && request.method === "POST") { const body = await request.json(); const auth = await authenticate(request, String(body.initData ?? "")); parseEventStartParam(auth.startParam); return json({ user: { id: auth.user.id, telegramUserId: auth.user.telegram_user_id, username: auth.user.username, firstName: auth.user.first_name, lastName: auth.user.last_name, photoUrl: auth.user.photo_url }, startParam: auth.startParam }); }
    const auth = await authenticate(request);
    if (path === "/events" && request.method === "POST") return await createEvent(request, auth);
    if (path === "/me/meetings" && request.method === "GET") return await meetings(auth);
    if (path === "/public/events" && request.method === "GET") return await publicEvents(request, auth);
    const responseMatch = path.match(/^\/events\/([^/]+)\/response$/); if (responseMatch && request.method === "POST") return await saveResponse(request, decodeURIComponent(responseMatch[1]), auth);
    const participationMatch = path.match(/^\/events\/([^/]+)\/participation$/); if (participationMatch && request.method === "DELETE") return await leaveParticipation(decodeURIComponent(participationMatch[1]), auth);
    const calendarLinkMatch = path.match(/^\/events\/([^/]+)\/calendar-link$/); if (calendarLinkMatch && request.method === "POST") return await calendarLink(request, decodeURIComponent(calendarLinkMatch[1]), auth);
    const joinRequestMatch = path.match(/^\/events\/([^/]+)\/join-request$/); if (joinRequestMatch && request.method === "POST") return await createJoinRequest(decodeURIComponent(joinRequestMatch[1]), auth);
    const organizerJoinRequestsMatch = path.match(/^\/events\/([^/]+)\/join-requests$/); if (organizerJoinRequestsMatch && request.method === "GET") return await organizerJoinRequests(decodeURIComponent(organizerJoinRequestsMatch[1]), auth);
    const joinRequestDecisionMatch = path.match(/^\/events\/([^/]+)\/join-requests\/([^/]+)\/(approve|reject)$/); if (joinRequestDecisionMatch && request.method === "POST") return await decideJoinRequest(joinRequestDecisionMatch[3] as JoinRequestDecisionAction, decodeURIComponent(joinRequestDecisionMatch[1]), decodeURIComponent(joinRequestDecisionMatch[2]), auth);
    const manageMatch = path.match(/^\/events\/([^/]+)\/manage$/); if (manageMatch && ["PATCH", "DELETE"].includes(request.method)) return await manageEvent(request, decodeURIComponent(manageMatch[1]), auth);
    const previewMatch = path.match(/^\/events\/([^/]+)\/preview$/); if (previewMatch && request.method === "GET") return json({ preview: await publicEventPreview(decodeURIComponent(previewMatch[1]), auth.user.id) });
    const eventMatch = path.match(/^\/events\/([^/]+)$/); if (eventMatch && request.method === "GET") return json({ event: await fullEventForRequest(decodeURIComponent(eventMatch[1]), auth.user.id) });
    return json({ error: "Маршрут не найден." }, 404);
  } catch (error) { return errorResponse(error); }
});
