import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { assertEventAvailable, assertOwner, assertVotingOpen, parseEventStartParam } from "../_shared/domain.ts";
import { corsHeaders, errorResponse, json } from "../_shared/http.ts";
import { validateTelegramInitData } from "../_shared/telegram.ts";

type Db = ReturnType<typeof createClient>;
type AppUser = { id: string; telegram_user_id: string; username: string | null; first_name: string; last_name: string | null; photo_url: string | null };
type AuthContext = { user: AppUser; startParam: string | null };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`; }

async function authenticate(request: Request, bodyInitData?: string): Promise<AuthContext> {
  const raw = bodyInitData ?? request.headers.get("x-telegram-init-data") ?? "";
  const validated = await validateTelegramInitData(raw, botToken, { maxAgeSeconds: 3600 });
  const profile = validated.user;
  const { data, error } = await db.from("users").upsert({ telegram_user_id: String(profile.id), username: profile.username ?? null, first_name: profile.first_name, last_name: profile.last_name ?? null, language_code: profile.language_code ?? null, photo_url: profile.photo_url ?? null, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" }).select("id,telegram_user_id,username,first_name,last_name,photo_url").single<AppUser>();
  if (error) throw error;
  return { user: data, startParam: validated.startParam };
}

async function eventPayload(eventId: string, userId: string) {
  const { data: event, error } = await db.from("events").select("id,owner_user_id,title,description,budget_limit,status,final_place_id,final_time_option_id,created_at,deleted_at").eq("id", eventId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  assertEventAvailable(event);
  const [{ data: times, error: timeError }, { data: places, error: placeError }, { data: people, error: peopleError }] = await Promise.all([
    db.from("time_options").select("id,starts_at").eq("event_id", eventId).order("starts_at"),
    db.from("place_options").select("id,title,area,estimated_budget").eq("event_id", eventId),
    db.from("participants").select("id,user_id,name,area,budget,preferences,restrictions").eq("event_id", eventId).order("created_at"),
  ]);
  if (timeError || placeError || peopleError) throw timeError ?? placeError ?? peopleError;
  const participantIds = (people ?? []).map((person) => person.id);
  const { data: votes, error: voteError } = participantIds.length ? await db.from("availability_votes").select("participant_id,time_option_id,is_available").in("participant_id", participantIds) : { data: [], error: null };
  if (voteError) throw voteError;
  const available = new Map<string, string[]>(); const unavailable = new Map<string, string[]>(); const counts = new Map<string, number>();
  for (const vote of votes ?? []) { const target = vote.is_available ? available : unavailable; target.set(vote.participant_id, [...(target.get(vote.participant_id) ?? []), vote.time_option_id]); if (vote.is_available) counts.set(vote.time_option_id, (counts.get(vote.time_option_id) ?? 0) + 1); }
  const canManage = event.owner_user_id === userId;
  const participants = (people ?? []).map((person) => ({ id: person.id, userId: person.user_id, name: person.name, area: person.area, budget: person.budget, preferences: canManage || person.user_id === userId ? person.preferences : "", restrictions: canManage || person.user_id === userId ? person.restrictions : "", availableTimeOptionIds: available.get(person.id) ?? [], unavailableTimeOptionIds: unavailable.get(person.id) ?? [] }));
  return { id: event.id, title: event.title, description: event.description, budgetLimit: event.budget_limit, status: event.status, finalPlaceId: event.final_place_id, finalTimeOptionId: event.final_time_option_id, timeOptions: (times ?? []).map((time) => ({ id: time.id, startsAt: time.starts_at, availableCount: counts.get(time.id) ?? 0 })), placeOptions: (places ?? []).map((place) => ({ id: place.id, title: place.title, area: place.area, estimatedBudget: place.estimated_budget })), participants, canManage, myResponse: participants.find((person) => person.userId === userId) ?? null, createdAt: event.created_at };
}

async function createEvent(request: Request, auth: AuthContext) {
  const payload = await request.json();
  const title = String(payload.title ?? "").trim();
  const times = [...new Set((payload.timeOptions ?? []).map(String).filter((value: string) => !Number.isNaN(Date.parse(value))))].sort() as string[];
  if (!title) throw Object.assign(new Error("Укажите название встречи."), { status: 400 });
  if (!times.length) throw Object.assign(new Error("Добавьте хотя бы один вариант даты и времени."), { status: 400 });
  const eventId = id("evt");
  const { error } = await db.from("events").insert({ id: eventId, admin_token: id("backup"), owner_user_id: auth.user.id, title, description: String(payload.description ?? "").trim(), budget_limit: Math.max(0, Number(payload.budgetLimit) || 0) });
  if (error) throw error;
  const { error: timeError } = await db.from("time_options").insert(times.map((startsAt) => ({ id: id("time"), event_id: eventId, starts_at: startsAt })));
  if (timeError) throw timeError;
  const places = (payload.placeOptions ?? []).filter((place: { title?: string }) => place.title?.trim()).map((place: { title: string; area?: string; estimatedBudget?: number }) => ({ id: id("place"), event_id: eventId, title: place.title.trim(), area: String(place.area ?? "").trim(), estimated_budget: Math.max(0, Number(place.estimatedBudget) || 0) }));
  if (places.length) { const { error: placeError } = await db.from("place_options").insert(places); if (placeError) throw placeError; }
  return json({ event: await eventPayload(eventId, auth.user.id) }, 201);
}

async function saveResponse(request: Request, eventId: string, auth: AuthContext) {
  const payload = await request.json();
  const { data: event, error } = await db.from("events").select("status").eq("id", eventId).is("deleted_at", null).maybeSingle();
  if (error) throw error; if (!event) throw Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 }); assertVotingOpen(event.status);
  const { data: options, error: optionsError } = await db.from("time_options").select("id").eq("event_id", eventId); if (optionsError) throw optionsError;
  const validIds = new Set((options ?? []).map((option) => option.id)); const availableIds = [...new Set((payload.availableTimeOptionIds ?? []).map(String))] as string[];
  if (availableIds.some((optionId) => !validIds.has(optionId))) throw Object.assign(new Error("Один из вариантов времени больше недоступен."), { status: 400 });
  const name = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(" ");
  const values = { name, area: String(payload.area ?? "").trim(), budget: Math.max(0, Number(payload.budget) || 0), preferences: String(payload.preferences ?? "").trim(), restrictions: String(payload.restrictions ?? "").trim() };
  const { data: existing, error: existingError } = await db.from("participants").select("id").eq("event_id", eventId).eq("user_id", auth.user.id).maybeSingle(); if (existingError) throw existingError;
  const participantId = existing?.id ?? crypto.randomUUID();
  const participantError = existing ? (await db.from("participants").update(values).eq("event_id", eventId).eq("user_id", auth.user.id)).error : (await db.from("participants").insert({ id: participantId, event_id: eventId, user_id: auth.user.id, edit_token: crypto.randomUUID(), ...values })).error;
  if (participantError) throw participantError;
  const { error: deleteError } = await db.from("availability_votes").delete().eq("participant_id", participantId); if (deleteError) throw deleteError;
  const rows = (options ?? []).map((option) => ({ participant_id: participantId, time_option_id: option.id, is_available: availableIds.includes(option.id) }));
  if (rows.length) { const { error: voteError } = await db.from("availability_votes").insert(rows); if (voteError) throw voteError; }
  return json({ event: await eventPayload(eventId, auth.user.id) });
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
  const mapItem = async (eventId: string, role: "owner" | "participant") => { const event = await eventPayload(eventId, auth.user.id); const best = event.timeOptions.slice().sort((a, b) => b.availableCount - a.availableCount || a.startsAt.localeCompare(b.startsAt))[0] ?? null; return { id: event.id, title: event.title, status: event.status, role, participantCount: event.participants.length, bestTime: best, createdAt: event.createdAt }; };
  return json({ owned: await Promise.all(ownedIds.map((eventId) => mapItem(eventId, "owner"))), participating: await Promise.all(participatingIds.map((eventId) => mapItem(eventId, "participant"))) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(request.url); const segments = url.pathname.split("/").filter(Boolean); const functionIndex = segments.lastIndexOf("telegram-api"); const path = `/${segments.slice(functionIndex + 1).join("/")}`;
    if (path === "/telegram/auth" && request.method === "POST") { const body = await request.json(); const auth = await authenticate(request, String(body.initData ?? "")); parseEventStartParam(auth.startParam); return json({ user: { id: auth.user.id, telegramUserId: auth.user.telegram_user_id, username: auth.user.username, firstName: auth.user.first_name, lastName: auth.user.last_name, photoUrl: auth.user.photo_url }, startParam: auth.startParam }); }
    const auth = await authenticate(request);
    if (path === "/events" && request.method === "POST") return await createEvent(request, auth);
    if (path === "/me/meetings" && request.method === "GET") return await meetings(auth);
    const responseMatch = path.match(/^\/events\/([^/]+)\/response$/); if (responseMatch && request.method === "POST") return await saveResponse(request, decodeURIComponent(responseMatch[1]), auth);
    const manageMatch = path.match(/^\/events\/([^/]+)\/manage$/); if (manageMatch && ["PATCH", "DELETE"].includes(request.method)) return await manageEvent(request, decodeURIComponent(manageMatch[1]), auth);
    const eventMatch = path.match(/^\/events\/([^/]+)$/); if (eventMatch && request.method === "GET") return json({ event: await eventPayload(decodeURIComponent(eventMatch[1]), auth.user.id) });
    return json({ error: "Маршрут не найден." }, 404);
  } catch (error) { return errorResponse(error); }
});
