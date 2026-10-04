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

const migrationNames = [
  "20261004134628_create_event_idempotency_table.sql",
  "20261004135940_create_event_idempotent_rpc.sql",
  "20261004135954_purge_event_creation_requests.sql",
];
const [tableMigration, rpcMigration, purgeMigration] = migrationNames.map((name) =>
  readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n"));
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8")
  .replace(/\r\n/g, "\n");
const createEvent = api.slice(
  api.indexOf("async function createEvent"),
  api.indexOf("async function createJoinRequest"),
);
const rpc = rpcMigration.slice(
  rpcMigration.indexOf("create or replace function public.create_event_idempotent"),
  rpcMigration.indexOf("revoke all on function"),
);
const helper = rpcMigration.slice(
  rpcMigration.indexOf("create or replace function public.release_deleted_event_creation_key"),
  rpcMigration.indexOf("create or replace function public.create_event_idempotent"),
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

describe("create-event idempotency migrations", () => {
  it("adds three focused migrations after the atomic creation migration", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    const added = migrations.filter((name) => name > "20260827204941_participant_option_proposals.sql");
    expect(added).toEqual(migrationNames);
  });

  it("scopes keys per owner and ties each key to its event", () => {
    expect(tableMigration).toContain("primary key (owner_user_id, client_request_id)");
    expect(tableMigration).toContain("references public.users(id) on delete cascade");
    expect(tableMigration).toContain("references public.events(id) on delete cascade\n    deferrable initially deferred");
    expect(tableMigration).toContain("check (request_hash ~ '^[0-9a-f]{64}$')");
  });

  it("locks the key table away from browser roles", () => {
    expect(tableMigration).toContain("alter table public.event_creation_requests enable row level security;");
    for (const role of ["public", "anon", "authenticated"])
      expect(tableMigration).toContain(`revoke all privileges on table public.event_creation_requests from ${role};`);
  });

  it("defines hardened RPCs callable only by service_role, revoked in the same migration", () => {
    for (const body of [rpc, helper]) {
      expect(body).toContain("security definer set search_path = pg_catalog, public");
    }
    expect(rpc).toContain("returns table (event_id text, replayed boolean)");
    expect(rpcMigration).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
    expect(rpcMigration).toContain(`grant execute on function ${signature} to service_role;`);
    expect(rpcMigration).toContain(
      "revoke all on function public.release_deleted_event_creation_key(uuid, uuid) from public, anon, authenticated;",
    );
    expect(rpcMigration).not.toContain("grant execute on function public.release_deleted_event_creation_key");
    expect(rpc).toContain("from public.create_event_atomic(");
    expect(rpc).not.toContain("insert into public.events");
  });

  it("validates the actor before claiming a key", () => {
    const actorCheck = rpc.indexOf("message = 'CREATE_EVENT_ACTOR_INVALID'");
    expect(actorCheck).toBeGreaterThan(-1);
    expect(actorCheck).toBeLessThan(rpc.indexOf("insert into public.event_creation_requests"));
  });

  it("releases a key whose event was soft-deleted before claiming", () => {
    const release = rpc.indexOf("perform public.release_deleted_event_creation_key(p_actor_user_id, p_client_request_id);");
    expect(release).toBeGreaterThan(-1);
    expect(release).toBeLessThan(rpc.indexOf("insert into public.event_creation_requests"));
    expect(helper).toContain("and e.id = r.event_id and e.deleted_at is not null;");
  });

  it("claims the key before creating and replays or rejects on conflict", () => {
    const claim = rpc.indexOf("insert into public.event_creation_requests");
    expect(rpc).toContain("on conflict on constraint event_creation_requests_pkey do nothing");
    expect(claim).toBeLessThan(rpc.indexOf("from public.create_event_atomic("));
    expect(rpc).toContain("return query select v_existing, true;");
    expect(rpc).toContain("message = 'CREATE_EVENT_IDEMPOTENCY_CONFLICT'");
    expect(rpc).toContain("return query select v_event_id, false;");
  });

  it("purges keys after 30 days on a daily schedule", () => {
    expect(purgeMigration).toContain("where created_at < now() - interval '30 days'");
    expect(purgeMigration).toContain("'purge-event-creation-requests-daily'");
    expect(purgeMigration).toContain("'SELECT public.purge_event_creation_requests();'");
    for (const role of ["public", "anon", "authenticated"])
      expect(purgeMigration).toContain(`revoke all on function public.purge_event_creation_requests() from ${role};`);
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
