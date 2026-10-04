import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  eventCreationErrorToken,
  eventCreationHttpError,
  eventCreationRequestHash,
  parseClientRequestId,
  type EventCreationFingerprint,
} from "../supabase/functions/_shared/event-creation";
import { errorResponse } from "../supabase/functions/_shared/http";

const migrationName = "20261004090000_create_event_idempotency.sql";
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8")
  .replace(/\r\n/g, "\n");
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8")
  .replace(/\r\n/g, "\n");
const createEvent = api.slice(
  api.indexOf("async function createEvent"),
  api.indexOf("async function createJoinRequest"),
);
const rpc = migration.slice(
  migration.indexOf("create or replace function public.create_event_idempotent"),
  migration.indexOf("revoke all on function public.create_event_idempotent"),
);
const signature =
  "public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb)";

const fingerprint: EventCreationFingerprint = {
  title: "Шашлыки",
  description: "",
  budgetLimit: 30,
  visibility: "private",
  maxParticipants: null,
  startsAt: ["2026-10-10T15:00:00.000Z"],
  places: [{ title: "Парк", area: "Центр", estimatedBudget: 20 }],
};

describe("create-event idempotency migration", () => {
  it("adds one migration after the atomic creation migration", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    expect(migrations.filter((name) => name.includes("create_event_idempotency")))
      .toEqual([migrationName]);
    expect(migrations.indexOf(migrationName))
      .toBeGreaterThan(migrations.indexOf("20260825192358_atomic_event_creation.sql"));
  });

  it("scopes keys per owner and ties each key to its event", () => {
    expect(migration).toContain("primary key (owner_user_id, client_request_id)");
    expect(migration).toContain("references public.users(id) on delete cascade");
    expect(migration).toContain("references public.events(id) on delete cascade\n    deferrable initially deferred");
    expect(migration).toContain("check (request_hash ~ '^[0-9a-f]{64}$')");
  });

  it("locks the key table away from browser roles", () => {
    expect(migration).toContain("alter table public.event_creation_requests enable row level security;");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(`revoke all privileges on table public.event_creation_requests from ${role};`);
  });

  it("defines a hardened service-role-only RPC that reuses atomic creation", () => {
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("set search_path = pg_catalog, public");
    expect(rpc).toContain("returns table (event_id text, replayed boolean)");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(`revoke all on function ${signature} from ${role};`);
    expect(migration).toContain(`grant execute on function ${signature}\n  to service_role;`);
    expect(rpc).toContain("from public.create_event_atomic(");
    expect(rpc).not.toContain("insert into public.events");
  });

  it("claims the key before creating and replays or rejects on conflict", () => {
    const claim = rpc.indexOf("insert into public.event_creation_requests");
    expect(claim).toBeGreaterThan(-1);
    expect(rpc).toContain("on conflict on constraint event_creation_requests_pkey do nothing");
    expect(claim).toBeLessThan(rpc.indexOf("from public.create_event_atomic("));
    expect(rpc).toContain("return query select v_existing_event_id, true;");
    expect(rpc).toContain("message = 'CREATE_EVENT_IDEMPOTENCY_CONFLICT'");
    expect(rpc).toContain("return query select v_event_id, false;");
  });

  it("validates the actor before claiming a key", () => {
    const actorCheck = rpc.indexOf("message = 'CREATE_EVENT_ACTOR_INVALID'");
    expect(actorCheck).toBeGreaterThan(-1);
    expect(actorCheck).toBeLessThan(rpc.indexOf("insert into public.event_creation_requests"));
  });

  it("releases a key whose event was soft-deleted before claiming", () => {
    const release = rpc.indexOf("delete from public.event_creation_requests as request");
    expect(release).toBeGreaterThan(-1);
    expect(release).toBeLessThan(rpc.indexOf("insert into public.event_creation_requests"));
    expect(rpc).toContain("and event.deleted_at is not null;");
  });

  it("purges keys after 30 days on a daily schedule", () => {
    expect(migration).toContain("where created_at < now() - interval '30 days'");
    expect(migration).toContain("'purge-event-creation-requests-daily'");
    expect(migration).toContain("'SELECT public.purge_event_creation_requests();'");
  });
});

describe("create-event idempotency edge helpers", () => {
  it("accepts an absent key and normalizes a UUID key", () => {
    expect(parseClientRequestId(undefined)).toBeNull();
    expect(parseClientRequestId(null)).toBeNull();
    expect(parseClientRequestId(" 0F8FAD5B-D9CB-469F-A165-70867728950E "))
      .toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("rejects malformed keys with a 400", () => {
    for (const value of ["", "not-a-uuid", 42, {}, "0f8fad5b-d9cb-469f-a165-70867728950"]) {
      expect(() => parseClientRequestId(value)).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    }
  });

  it("hashes the normalized request deterministically", async () => {
    const hash = await eventCreationRequestHash(fingerprint);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await eventCreationRequestHash({ ...fingerprint })).toBe(hash);
    expect(await eventCreationRequestHash({ ...fingerprint, title: "Кино" })).not.toBe(hash);
    expect(await eventCreationRequestHash({
      ...fingerprint,
      places: [{ title: "Парк", area: "Центр", estimatedBudget: 21 }],
    })).not.toBe(hash);
  });

  it("ignores server-generated option ids in the hash", async () => {
    const withIds = {
      ...fingerprint,
      places: [{ id: "place_one", title: "Парк", area: "Центр", estimatedBudget: 20 }],
    };
    expect(await eventCreationRequestHash(withIds))
      .toBe(await eventCreationRequestHash(fingerprint));
  });

  it("maps the conflict token to a safe 409", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = { code: "P0001", message: "CREATE_EVENT_IDEMPOTENCY_CONFLICT" };
    expect(eventCreationErrorToken(token)).toBe("CREATE_EVENT_IDEMPOTENCY_CONFLICT");
    const response = errorResponse(eventCreationHttpError(token));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("ещё раз");
  });
});

describe("telegram-api create-event idempotency integration", () => {
  it("uses the idempotent RPC only when the client sends a key", () => {
    expect(createEvent).toContain("const clientRequestId = parseClientRequestId(payload.clientRequestId);");
    expect(createEvent).toContain(
      'const rpcName = clientRequestId ? "create_event_idempotent" : "create_event_atomic";',
    );
    expect(createEvent.match(/db\.rpc\(/g)).toHaveLength(1);
  });

  it("hashes the Edge-normalized input, not the raw payload", () => {
    expect(createEvent).toContain("p_request_hash: await eventCreationRequestHash({");
    expect(createEvent).toContain("startsAt: times,");
    expect(createEvent).not.toContain("eventCreationRequestHash(payload");
  });

  it("returns 200 for a replay and 201 for a new event", () => {
    expect(createEvent).toContain('const replayed = !!data && "replayed" in data && data.replayed === true;');
    expect(createEvent).toContain("replayed ? 200 : 201)");
  });
});
