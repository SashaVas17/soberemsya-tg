import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260814104624_open_meetings_foundation.sql",
  "utf8",
);
const createRequest = migration.slice(
  migration.indexOf("create or replace function public.create_join_request"),
  migration.indexOf("create or replace function public.approve_join_request"),
);
const approveRequest = migration.slice(
  migration.indexOf("create or replace function public.approve_join_request"),
  migration.indexOf("create or replace function public.reject_join_request"),
);
const rejectRequest = migration.slice(
  migration.indexOf("create or replace function public.reject_join_request"),
  migration.indexOf("revoke all on function public.approve_join_request"),
);

function errorTokens(source: string) {
  return [...source.matchAll(/message = '([A-Z_]+)'/g)].map((match) => match[1]);
}

function ownerGuard(source: string) {
  const tokenIndex = source.indexOf("message = 'NOT_EVENT_OWNER'");
  const start = source.lastIndexOf("if ", tokenIndex);
  const end = source.indexOf("end if;", tokenIndex);
  return source.slice(start, end + "end if;".length);
}

function ownerGuardRejects(ownerUserId: string | null, actorUserId: string | null) {
  return actorUserId === null || ownerUserId === null || ownerUserId !== actorUserId;
}

describe("Open Meetings database foundation", () => {
  it("defaults every existing and future event to private visibility", () => {
    expect(migration).toContain("visibility text not null default 'private'");
    expect(migration).toContain("set visibility = 'private'");
    expect(migration).toContain("visibility in ('private', 'public')");
  });

  it("keeps capacity private-only null and allows only public null or 2 through 50", () => {
    expect(migration).toContain("max_participants integer");
    expect(migration).toContain("visibility = 'private' and max_participants is null");
    expect(migration).toContain("max_participants is null");
    expect(migration).toContain("max_participants between 2 and 50");
  });

  it("defines one status-consistent request per user and event", () => {
    expect(migration).toContain("unique (event_id, requester_user_id)");
    expect(migration).toContain("status in ('pending', 'approved', 'rejected')");
    expect(migration).toContain("status = 'pending' and decided_at is null and decided_by_user_id is null");
    expect(migration).toContain("status in ('approved', 'rejected')");
    expect(migration).toContain("and decided_at is not null");
    expect(migration).not.toContain("and decided_by_user_id is not null");
  });

  it("creates only the request-operation indexes", () => {
    expect(migration).toContain("join_requests_event_pending_idx");
    expect(migration).toContain("where status = 'pending'");
    expect(migration).toContain("join_requests_requester_created_idx");
    expect(migration).not.toContain("events_public_feed_idx");
  });

  describe("atomic create_join_request", () => {
    it("defines the exact text and uuid signature", () => {
      expect(createRequest).toContain("create or replace function public.create_join_request(");
      expect(createRequest).toContain("p_event_id text");
      expect(createRequest).toContain("p_requester_user_id uuid");
      expect(migration).toContain("public.create_join_request(text, uuid)");
    });

    it("returns only request identity, status and a stable outcome", () => {
      expect(createRequest).toContain("returns table (request_id uuid, status text, outcome text)");
      expect(createRequest).not.toContain("owner_user_id uuid");
      expect(createRequest).not.toContain("requester_user_id uuid,");
    });

    it("uses SECURITY DEFINER with the fixed search path", () => {
      expect(createRequest).toContain("security definer");
      expect(createRequest).toContain("set search_path = pg_catalog, public");
    });

    it.each(["public", "anon", "authenticated"])("revokes %s execution", (role) => {
      expect(migration).toContain(`revoke all on function public.create_join_request(text, uuid) from ${role};`);
    });

    it("grants execution only to service_role", () => {
      expect(migration).toContain("grant execute on function public.create_join_request(text, uuid)\n  to service_role;");
      expect(migration).not.toContain("grant execute on function public.create_join_request(text, uuid)\n  to anon");
      expect(migration).not.toContain("grant execute on function public.create_join_request(text, uuid)\n  to authenticated");
    });

    it("locks the available event row before every other authority read", () => {
      expect(createRequest).toMatch(/from public\.events\r?\n[ ]{2}where id = p_event_id\r?\n[ ]{4}and deleted_at is null\r?\n[ ]{2}for update/);
      expect(createRequest.indexOf("from public.events")).toBeLessThan(createRequest.indexOf("from public.join_requests"));
      expect(createRequest.indexOf("from public.events")).toBeLessThan(createRequest.indexOf("from public.participants"));
    });

    it("uses a stable unavailable token for missing and deleted events", () => {
      expect(createRequest).toContain("and deleted_at is null");
      expect(createRequest).toContain("message = 'EVENT_UNAVAILABLE'");
    });

    it("rejects private, ownerless and non-collecting events", () => {
      expect(createRequest).toContain("v_event.visibility <> 'public'");
      expect(createRequest).toContain("v_event.owner_user_id is null");
      expect(createRequest).toContain("v_event.status <> 'collecting'");
      expect(createRequest).toContain("message = 'JOIN_REQUEST_NOT_ALLOWED'");
    });

    it("rejects the event owner and an unavailable requester", () => {
      expect(createRequest).toContain("p_requester_user_id = v_event.owner_user_id");
      expect(createRequest).toContain("message = 'OWNER_CANNOT_JOIN'");
      expect(createRequest).toContain("p_requester_user_id is null");
      expect(createRequest).toContain("message = 'REQUESTER_UNAVAILABLE'");
    });

    it("locks the one existing request after the event lock", () => {
      const requestRead = createRequest.indexOf("from public.join_requests");
      expect(requestRead).toBeGreaterThan(createRequest.indexOf("from public.events"));
      expect(createRequest.slice(requestRead)).toContain("for update");
      expect(createRequest).toContain("v_request_found := found");
    });

    it("treats participant membership as authoritative before creating pending", () => {
      const participantRead = createRequest.indexOf("from public.participants");
      const pendingInsert = createRequest.indexOf("insert into public.join_requests");
      expect(participantRead).toBeGreaterThan(createRequest.indexOf("from public.join_requests"));
      expect(participantRead).toBeLessThan(pendingInsert);
      expect(createRequest).toContain("'already_participant'::text");
      expect(createRequest).toContain("'approved'::text");
    });

    it("inserts one pending row only when no request exists", () => {
      expect(createRequest).toContain("if not v_request_found then");
      expect(createRequest).toContain("insert into public.join_requests (event_id, requester_user_id)");
      expect(createRequest).toContain("'created_pending'::text");
      expect(createRequest.match(/insert into public\.join_requests/g)).toHaveLength(1);
    });

    it("returns an existing pending request without updating it", () => {
      const pendingBranch = createRequest.slice(
        createRequest.indexOf("if v_request.status = 'pending'"),
        createRequest.indexOf("if v_request.status = 'rejected'"),
      );
      expect(pendingBranch).toContain("'existing_pending'::text");
      expect(pendingBranch).not.toContain("update public.join_requests");
      expect(pendingBranch).not.toContain("created_at");
    });

    it("keeps rejection final without resetting the row", () => {
      const rejectedBranch = createRequest.slice(createRequest.indexOf("if v_request.status = 'rejected'"));
      expect(rejectedBranch).toContain("message = 'JOIN_REQUEST_REJECTED'");
      expect(rejectedBranch).not.toContain("update public.join_requests");
      expect(rejectedBranch).not.toContain("set status = 'pending'");
    });

    it("fails approved-without-participant as an inconsistent state", () => {
      expect(createRequest).toContain("message = 'JOIN_REQUEST_STATE_INCONSISTENT'");
      expect(createRequest.indexOf("'already_participant'::text")).toBeLessThan(createRequest.indexOf("JOIN_REQUEST_STATE_INCONSISTENT"));
    });

    it("preserves the unique event and requester constraint", () => {
      expect(migration).toContain("unique (event_id, requester_user_id)");
    });

    it("adds neither delete behavior nor capacity checks", () => {
      expect(createRequest).not.toContain("delete from");
      expect(createRequest).not.toContain("max_participants");
      expect(createRequest).not.toContain("v_participant_count");
    });

    it("leaves approval as the only capacity authority", () => {
      const approve = migration.slice(
        migration.indexOf("create or replace function public.approve_join_request"),
        migration.indexOf("create or replace function public.reject_join_request"),
      );
      expect(approve).toContain("v_event.max_participants");
      expect(approve).toContain("1 + v_participant_count >= v_event.max_participants");
      expect(createRequest).not.toContain("capacity");
    });

    it("serializes duplicate creates and lifecycle transitions on the event row", () => {
      const eventLock = createRequest.indexOf("from public.events");
      const statusCheck = createRequest.indexOf("v_event.status <> 'collecting'");
      const requestLock = createRequest.indexOf("from public.join_requests");
      const insert = createRequest.indexOf("insert into public.join_requests");
      expect(eventLock).toBeLessThan(statusCheck);
      expect(statusCheck).toBeLessThan(requestLock);
      expect(requestLock).toBeLessThan(insert);
      expect(createRequest).toContain("for update");
    });

    it("introduces no frontend policy or table grant", () => {
      expect(createRequest).not.toContain("create policy");
      expect(createRequest).not.toContain("grant select");
      expect(createRequest).not.toContain("grant insert");
      expect(migration).toContain("revoke all privileges on table public.join_requests from anon");
      expect(migration).toContain("revoke all privileges on table public.join_requests from authenticated");
    });

    it("uses structured outcomes for success and short stable exception tokens", () => {
      for (const outcome of ["created_pending", "existing_pending", "already_participant"])
        expect(createRequest).toContain(`'${outcome}'::text`);
      for (const token of ["EVENT_UNAVAILABLE", "JOIN_REQUEST_NOT_ALLOWED", "REQUESTER_UNAVAILABLE", "OWNER_CANNOT_JOIN", "JOIN_REQUEST_REJECTED", "JOIN_REQUEST_STATE_INCONSISTENT"])
        expect(createRequest).toContain(`message = '${token}'`);
    });
  });

  describe("approve_join_request error contract", () => {
    it("uses the exact stable domain tokens", () => {
      expect(errorTokens(approveRequest)).toEqual([
        "EVENT_UNAVAILABLE",
        "NOT_EVENT_OWNER",
        "JOIN_REQUEST_NOT_ALLOWED",
        "JOIN_REQUESTS_CLOSED",
        "JOIN_REQUEST_UNAVAILABLE",
        "JOIN_REQUEST_NOT_PENDING",
        "OWNER_CANNOT_JOIN",
        "JOIN_REQUEST_STATE_INCONSISTENT",
        "REQUESTER_UNAVAILABLE",
        "EVENT_FULL",
      ]);
    });

    it("treats missing and deleted events as unavailable before authorization", () => {
      expect(approveRequest).toMatch(
        /from public\.events\r?\n[ ]{2}where id = p_event_id\r?\n[ ]{4}and deleted_at is null\r?\n[ ]{2}for update/,
      );
      expect(approveRequest.indexOf("message = 'EVENT_UNAVAILABLE'")).toBeLessThan(
        approveRequest.indexOf("v_event.owner_user_id"),
      );
    });

    it("separates a missing request from a non-pending request after locking", () => {
      const requestRead = approveRequest.indexOf("from public.join_requests");
      const unavailable = approveRequest.indexOf("message = 'JOIN_REQUEST_UNAVAILABLE'");
      const notPending = approveRequest.indexOf("message = 'JOIN_REQUEST_NOT_PENDING'");
      expect(approveRequest.slice(requestRead, unavailable)).toContain("for update");
      expect(approveRequest.slice(requestRead, unavailable)).toContain("if not found then");
      expect(approveRequest.slice(unavailable, notPending)).toContain("v_request.status <> 'pending'");
      expect(requestRead).toBeLessThan(unavailable);
      expect(unavailable).toBeLessThan(notPending);
    });

    it("maps owner, visibility, lifecycle, owner-requester and missing-user failures", () => {
      expect(approveRequest).toContain("v_event.owner_user_id <> p_actor_user_id");
      expect(approveRequest).toContain("message = 'NOT_EVENT_OWNER'");
      expect(approveRequest).toContain("v_event.visibility <> 'public'");
      expect(approveRequest).toContain("message = 'JOIN_REQUEST_NOT_ALLOWED'");
      expect(approveRequest).toContain("v_event.status <> 'collecting'");
      expect(approveRequest).toContain("message = 'JOIN_REQUESTS_CLOSED'");
      expect(approveRequest).toContain("v_request.requester_user_id = v_event.owner_user_id");
      expect(approveRequest).toContain("message = 'OWNER_CANNOT_JOIN'");
      expect(approveRequest).toContain("message = 'REQUESTER_UNAVAILABLE'");
    });

    it("rejects a null approve actor through NOT_EVENT_OWNER", () => {
      expect(ownerGuard(approveRequest)).toMatch(
        /if p_actor_user_id is null\r?\n[ ]{4}or v_event\.owner_user_id is null\r?\n[ ]{4}or v_event\.owner_user_id <> p_actor_user_id then\r?\n[ ]{4}raise exception using errcode = 'P0001', message = 'NOT_EVENT_OWNER';\r?\n[ ]{2}end if;/,
      );
    });

    it("treats a pending request with participant membership as inconsistent", () => {
      const participantCheck = approveRequest.indexOf("if exists (");
      const inconsistent = approveRequest.indexOf("message = 'JOIN_REQUEST_STATE_INCONSISTENT'");
      expect(participantCheck).toBeGreaterThan(approveRequest.indexOf("v_request.status <> 'pending'"));
      expect(participantCheck).toBeLessThan(inconsistent);
      expect(approveRequest.slice(participantCheck, inconsistent)).toContain("from public.participants");
    });

    it("uses P0001 for every expected domain token and removes old prose", () => {
      expect(approveRequest.match(/raise exception using errcode = 'P0001'/g)).toHaveLength(10);
      for (const message of [
        "Event not found",
        "Only the event owner can approve requests",
        "Join requests are unavailable for this event",
        "Join requests are closed for this event",
        "Pending join request not found",
        "Event owner cannot join their own event",
        "Participant already exists",
        "Requester user not found",
        "Event capacity has been reached",
      ]) expect(approveRequest).not.toContain(message);
    });

    it("preserves signature, return type, security and mutation ordering", () => {
      expect(approveRequest).toContain("p_event_id text");
      expect(approveRequest).toContain("p_request_id uuid");
      expect(approveRequest).toContain("p_actor_user_id uuid");
      expect(approveRequest).toContain("returns table (request_id uuid, participant_id uuid)");
      expect(approveRequest).toContain("security definer");
      expect(approveRequest).toContain("set search_path = pg_catalog, public");
      const eventLock = approveRequest.indexOf("from public.events");
      const requestLock = approveRequest.indexOf("from public.join_requests");
      const capacity = approveRequest.indexOf("select count(*)::integer");
      const participantInsert = approveRequest.indexOf("insert into public.participants");
      const requestUpdate = approveRequest.indexOf("update public.join_requests");
      expect(eventLock).toBeLessThan(requestLock);
      expect(requestLock).toBeLessThan(capacity);
      expect(capacity).toBeLessThan(participantInsert);
      expect(participantInsert).toBeLessThan(requestUpdate);
    });

    it("keeps the audited capacity calculation and changes only its token", () => {
      expect(approveRequest).toContain("user_id is null");
      expect(approveRequest).toContain("or user_id <> v_event.owner_user_id");
      expect(approveRequest).toContain("1 + v_participant_count >= v_event.max_participants");
      expect(approveRequest).toContain("message = 'EVENT_FULL'");
    });
  });

  describe("reject_join_request error contract", () => {
    it("uses the exact stable domain tokens", () => {
      expect(errorTokens(rejectRequest)).toEqual([
        "EVENT_UNAVAILABLE",
        "NOT_EVENT_OWNER",
        "JOIN_REQUEST_NOT_ALLOWED",
        "JOIN_REQUEST_UNAVAILABLE",
        "JOIN_REQUEST_NOT_PENDING",
      ]);
    });

    it("treats missing and deleted events as unavailable before authorization", () => {
      expect(rejectRequest).toMatch(
        /from public\.events\r?\n[ ]{2}where id = p_event_id\r?\n[ ]{4}and deleted_at is null\r?\n[ ]{2}for update/,
      );
      expect(rejectRequest.indexOf("message = 'EVENT_UNAVAILABLE'")).toBeLessThan(
        rejectRequest.indexOf("v_event.owner_user_id"),
      );
    });

    it("separates missing and non-pending requests without cross-event lookup", () => {
      const requestRead = rejectRequest.indexOf("from public.join_requests");
      const unavailable = rejectRequest.indexOf("message = 'JOIN_REQUEST_UNAVAILABLE'");
      const notPending = rejectRequest.indexOf("message = 'JOIN_REQUEST_NOT_PENDING'");
      expect(rejectRequest.slice(requestRead, unavailable)).toContain("id = p_request_id");
      expect(rejectRequest.slice(requestRead, unavailable)).toContain("event_id = p_event_id");
      expect(rejectRequest.slice(requestRead, unavailable)).toContain("for update");
      expect(rejectRequest.slice(requestRead, unavailable)).toContain("if not found then");
      expect(rejectRequest.slice(unavailable, notPending)).toContain("v_request.status <> 'pending'");
    });

    it("keeps rejection available outside collecting", () => {
      expect(rejectRequest).not.toContain("v_event.status");
      expect(rejectRequest).not.toContain("JOIN_REQUESTS_CLOSED");
      expect(rejectRequest).toContain("set status = 'rejected'");
    });

    it("rejects a null reject actor through NOT_EVENT_OWNER", () => {
      expect(ownerGuard(rejectRequest)).toMatch(
        /if p_actor_user_id is null\r?\n[ ]{4}or v_event\.owner_user_id is null\r?\n[ ]{4}or v_event\.owner_user_id <> p_actor_user_id then\r?\n[ ]{4}raise exception using errcode = 'P0001', message = 'NOT_EVENT_OWNER';\r?\n[ ]{2}end if;/,
      );
    });

    it("uses P0001 for every domain token and removes old prose", () => {
      expect(rejectRequest.match(/raise exception using errcode = 'P0001'/g)).toHaveLength(5);
      for (const message of [
        "Event not found",
        "Only the event owner can reject requests",
        "Join requests are unavailable for this event",
        "Pending join request not found",
      ]) expect(rejectRequest).not.toContain(message);
    });

    it("preserves signature, return type, security and event-first lock order", () => {
      expect(rejectRequest).toContain("p_event_id text");
      expect(rejectRequest).toContain("p_request_id uuid");
      expect(rejectRequest).toContain("p_actor_user_id uuid");
      expect(rejectRequest).toContain("returns table (request_id uuid)");
      expect(rejectRequest).toContain("security definer");
      expect(rejectRequest).toContain("set search_path = pg_catalog, public");
      expect(rejectRequest.indexOf("from public.events")).toBeLessThan(
        rejectRequest.indexOf("from public.join_requests"),
      );
      expect(rejectRequest).not.toContain("insert into public.participants");
    });
  });

  it("counts the owner once while including ordinary and legacy participant rows", () => {
    expect(approveRequest).toContain("1 + v_participant_count");
    expect(approveRequest).toContain("user_id is null");
    expect(approveRequest).toContain("user_id <> v_event.owner_user_id");
  });

  it("uses the event lock to serialize approval of the last total-capacity seat", () => {
    expect(approveRequest).toMatch(
      /from public\.events\r?\n[ ]{2}where id = p_event_id\r?\n[ ]{4}and deleted_at is null\r?\n[ ]{2}for update/,
    );
    expect(approveRequest).toContain("select count(*)::integer");
  });

  it("rejects without creating a participant", () => {
    expect(rejectRequest).toContain("v_event.owner_user_id <> p_actor_user_id");
    expect(rejectRequest).toContain("v_event.visibility <> 'public'");
    expect(rejectRequest).toContain("set status = 'rejected'");
    expect(rejectRequest).not.toContain("insert into public.participants");
  });

  it("keeps direct table and function access off the frontend roles", () => {
    expect(migration).toContain("alter table public.join_requests enable row level security");
    expect(migration).toContain("revoke all privileges on table public.join_requests from public");
    expect(migration).toContain("revoke all privileges on table public.join_requests from anon");
    expect(migration).toContain("revoke all privileges on table public.join_requests from authenticated");
    expect(migration).toContain("grant select, insert, update on table public.join_requests to service_role");
    expect(migration).toContain("revoke all on function public.approve_join_request(text, uuid, uuid) from public");
    expect(migration).toContain("revoke all on function public.approve_join_request(text, uuid, uuid) from anon");
    expect(migration).toContain("revoke all on function public.approve_join_request(text, uuid, uuid) from authenticated");
    expect(migration).toContain("to service_role");
  });

  it("records the real actor while allowing a deleted decider to become null", () => {
    const approve = migration.slice(
      migration.indexOf("create or replace function public.approve_join_request"),
      migration.indexOf("create or replace function public.reject_join_request"),
    );
    const reject = migration.slice(
      migration.indexOf("create or replace function public.reject_join_request"),
      migration.indexOf("revoke all on function public.approve_join_request"),
    );
    expect(migration).toContain("decided_by_user_id uuid references public.users(id) on delete set null");
    expect(approve).toContain("decided_by_user_id = p_actor_user_id");
    expect(reject).toContain("decided_by_user_id = p_actor_user_id");
  });

  it.each([
    ["matching owner", "owner", "owner", false],
    ["wrong owner", "owner", "other", true],
    ["null actor", "owner", null, true],
    ["null owner", null, "actor", true],
  ] as const)("models the NULL-safe owner guard for %s", (_case, owner, actor, denied) => {
    expect(ownerGuardRejects(owner, actor)).toBe(denied);
  });

  it("documents the required public saveResponse guard without changing the private flow", () => {
    expect(migration).toContain("OPEN 2 must reject saveResponse for a public event unless the caller is an");
    expect(migration).toContain("approved participant");
    expect(migration).toContain("existing private response flow intentionally stays");
  });
});
