import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  participantOptionProposalErrorToken,
  participantOptionProposalHttpError,
} from "../supabase/functions/_shared/participant-option-proposal";
import { errorResponse } from "../supabase/functions/_shared/http";

const migrationPath =
  "supabase/migrations/20260827204941_participant_option_proposals.sql";
const migration = readFileSync(migrationPath, "utf8");
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const ownerOptions = readFileSync(
  "supabase/migrations/20260825170533_limit_event_option_additions.sql",
  "utf8",
);
const payload = readFileSync("supabase/functions/_shared/event-payload.ts", "utf8");
const timeRpc = migration.slice(
  migration.indexOf("create or replace function public.propose_event_time_option"),
  migration.indexOf("create or replace function public.propose_event_place_option"),
);
const placeRpc = migration.slice(
  migration.indexOf("create or replace function public.propose_event_place_option"),
  migration.indexOf("drop function public.save_event_response"),
);
const responseRpc = migration.slice(
  migration.indexOf("create function public.save_event_response"),
  migration.indexOf("revoke all on function public.propose_event_time_option"),
);
const proposeTime = api.slice(
  api.indexOf("async function proposeTimeOption"),
  api.indexOf("async function proposePlaceOption"),
);
const proposePlace = api.slice(
  api.indexOf("async function proposePlaceOption"),
  api.indexOf("async function leaveParticipation"),
);

function expectHardenedRpc(source: string, signature: string) {
  const normalizedMigration = migration.replace(/\s+/g, " ");
  expect(source).toContain("security definer");
  expect(source).toContain("set search_path = pg_catalog, public");
  for (const role of ["public", "anon", "authenticated"])
    expect(normalizedMigration).toContain(
      `revoke all on function ${signature} from ${role};`,
    );
  expect(normalizedMigration).toContain(
    `grant execute on function ${signature} to service_role;`,
  );
}

function expectEventLockAndCap(source: string, table: string, token: string) {
  const eventLock = source.indexOf("from public.events as event");
  const count = source.indexOf(`from public.${table} as option`);
  const insert = source.indexOf(`insert into public.${table}`);
  expect(eventLock).toBeGreaterThan(-1);
  expect(source.slice(eventLock, count)).toContain("for update");
  expect(count).toBeGreaterThan(eventLock);
  expect(source.indexOf(token)).toBeGreaterThan(count);
  expect(insert).toBeGreaterThan(count);
  expect(source).toContain("where option.event_id = p_event_id");
}

describe("participant option proposal database contract", () => {
  it("adds exactly one focused migration while retaining owner-only option RPCs", () => {
    expect(readdirSync("supabase/migrations").filter((name) =>
      name.includes("participant_option_proposals"),
    )).toEqual(["20260827204941_participant_option_proposals.sql"]);
    expect(ownerOptions).toContain("v_event.owner_user_id <> p_actor_user_id");
    expect(ownerOptions).toContain("NOT_EVENT_OWNER");
  });

  it("defines hardened server-only time and place proposal RPCs", () => {
    expect(timeRpc).toContain("p_event_id text");
    expect(timeRpc).toContain("p_actor_user_id uuid");
    expect(timeRpc).toContain("p_option_id text");
    expect(timeRpc).toContain("p_starts_at timestamptz");
    expect(placeRpc).toContain("p_title text");
    expect(placeRpc).toContain("p_area text");
    expect(placeRpc).toContain("p_estimated_budget integer");
    expect(timeRpc).toContain("returns table (option_id text)");
    expect(placeRpc).toContain("returns table (option_id text)");
    expectHardenedRpc(
      timeRpc,
      "public.propose_event_time_option(text, uuid, text, timestamptz)",
    );
    expectHardenedRpc(
      placeRpc,
      "public.propose_event_place_option(text, uuid, text, text, text, integer)",
    );
  });

  it("permits only response-eligible non-owner actors while collecting", () => {
    for (const source of [timeRpc, placeRpc]) {
      expect(source).toContain("v_event.status <> 'collecting'");
      expect(source).toContain("OPTION_PROPOSAL_CLOSED");
      expect(source).toContain("v_event.owner_user_id = p_actor_user_id");
      expect(source).toContain("OPTION_PROPOSAL_NOT_ALLOWED");
      expect(source).toContain("v_event.visibility = 'public' and not exists");
      expect(source).toContain("participant.event_id = p_event_id");
      expect(source).toContain("participant.user_id = p_actor_user_id");
      expect(source).not.toContain("join_requests");
    }
  });

  it("serializes both proposal caps with the existing event-row lock", () => {
    expectEventLockAndCap(timeRpc, "time_options", "TIME_OPTION_LIMIT_REACHED");
    expectEventLockAndCap(placeRpc, "place_options", "PLACE_OPTION_LIMIT_REACHED");
    expect(timeRpc).toContain("if v_option_count >= 50 then");
    expect(placeRpc).toContain("if v_option_count >= 50 then");
  });

  it("validates proposal input and always associates the inserted option with the event parameter", () => {
    expect(timeRpc).toContain("TIME_OPTION_INVALID");
    expect(placeRpc).toContain("PLACE_OPTION_INVALID");
    expect(placeRpc).toContain("char_length(p_title) > 200");
    expect(placeRpc).toContain("char_length(p_area) > 200");
    expect(placeRpc).toContain("p_estimated_budget < 0");
    expect(timeRpc).toContain("values (p_option_id, p_event_id, p_starts_at)");
    expect(placeRpc).toContain("p_option_id,\n    p_event_id,");
  });
});

describe("atomic place-selection response contract", () => {
  it("replaces the old signature with an additive optional place-id argument", () => {
    expect(migration).toContain(
      "drop function public.save_event_response(text, uuid, text, integer, text, text, text[]);",
    );
    expect(responseRpc).toContain("p_selected_place_option_ids text[] default null");
    expect(responseRpc).toContain("returns table (participant_id uuid)");
    expectHardenedRpc(
      responseRpc,
      "public.save_event_response(text, uuid, text, integer, text, text, text[], text[])",
    );
  });

  it("keeps omitted place ids non-mutating but atomically replaces explicit selections", () => {
    const validation = responseRpc.indexOf("if p_selected_place_option_ids is not null then");
    const participantUpsert = responseRpc.indexOf("on conflict (event_id, user_id) do update");
    const timeVotes = responseRpc.indexOf("delete from public.availability_votes as vote");
    const placeVotes = responseRpc.lastIndexOf("delete from public.place_votes as vote");
    expect(validation).toBeGreaterThan(-1);
    expect(responseRpc).toContain("array_agg(distinct supplied.place_option_id)");
    expect(responseRpc).toContain("PLACE_OPTION_UNAVAILABLE");
    expect(participantUpsert).toBeGreaterThan(validation);
    expect(timeVotes).toBeGreaterThan(participantUpsert);
    expect(placeVotes).toBeGreaterThan(timeVotes);
    expect(responseRpc).toContain("where vote.participant_id = v_participant_id");
    expect(responseRpc).toContain("insert into public.place_votes (participant_id, place_option_id)");
  });

  it("fetches and returns only the current viewer's selected place ids", () => {
    expect(payload).toContain("export type PayloadPlaceVote");
    expect(payload).toContain("selectedPlaceOptionIds: source.placeVotes");
    expect(payload).toContain("vote.participant_id === person.id");
    expect(payload).not.toContain("selectedPlaceOptionIds: available.get");
  });
});

describe("participant proposal HTTP contract", () => {
  it("uses authenticated actors, Edge-generated opaque ids, bounded input, and one RPC per route", () => {
    for (const source of [proposeTime, proposePlace]) {
      expect(source).toContain("readJsonObject(request, API_JSON_BODY_LIMIT_BYTES)");
      expect(source).toContain("p_actor_user_id: auth.user.id");
      expect(source).not.toContain("payload.actor");
      expect(source).not.toContain("payload.userId");
      expect(source).toContain("return json({ event: await eventPayload(eventId, auth.user.id) })");
    }
    expect(proposeTime.match(/db\.rpc\("propose_event_time_option"/g)).toHaveLength(1);
    expect(proposeTime).toContain('p_option_id: id("time")');
    expect(proposePlace.match(/db\.rpc\("propose_event_place_option"/g)).toHaveLength(1);
    expect(proposePlace).toContain('p_option_id: id("place")');
  });

  it("registers the two explicit proposal routes without weakening manage", () => {
    expect(api).toContain("/time-options\\/proposals");
    expect(api).toContain("/place-options\\/proposals");
    expect(api).toContain("return await proposeTimeOption");
    expect(api).toContain("return await proposePlaceOption");
    expect(api).toContain('db.rpc("add_event_time_option"');
    expect(api).toContain('db.rpc("add_event_place_option"');
  });

  it("maps only stable proposal failures to safe client responses", async () => {
    for (const [token, status] of [
      ["EVENT_UNAVAILABLE", 404],
      ["OPTION_PROPOSAL_NOT_ALLOWED", 403],
      ["OPTION_PROPOSAL_CLOSED", 409],
      ["TIME_OPTION_LIMIT_REACHED", 409],
      ["PLACE_OPTION_LIMIT_REACHED", 409],
      ["TIME_OPTION_INVALID", 400],
      ["PLACE_OPTION_INVALID", 400],
    ] as const) {
      const result = errorResponse(participantOptionProposalHttpError({ code: "P0001", message: token }));
      expect(result.status).toBe(status);
      expect((await result.json()).error).not.toMatch(/P0001|SQL|Postgres/i);
    }
    expect(participantOptionProposalErrorToken({ code: "23505", message: "TIME_OPTION_LIMIT_REACHED" })).toBeNull();
  });
});
