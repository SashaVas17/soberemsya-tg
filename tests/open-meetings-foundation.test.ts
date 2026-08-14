import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260811181309_open_meetings_foundation.sql",
  "utf8",
);
const createRequest = migration.slice(
  migration.indexOf("create or replace function public.create_join_request"),
  migration.indexOf("create or replace function public.approve_join_request"),
);

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

  it("approves atomically after owner, public, status, duplicate and final capacity checks", () => {
    const approve = migration.slice(
      migration.indexOf("create or replace function public.approve_join_request"),
      migration.indexOf("create or replace function public.reject_join_request"),
    );
    expect(approve).toContain("security definer");
    expect(approve).toContain("set search_path = pg_catalog, public");
    expect(approve).toContain("for update");
    expect(approve).toContain("v_event.owner_user_id <> p_actor_user_id");
    expect(approve).toContain("v_event.visibility <> 'public'");
    expect(approve).toContain("v_event.status <> 'collecting'");
    expect(approve).toContain("v_request.requester_user_id = v_event.owner_user_id");
    expect(approve).toContain("user_id is null");
    expect(approve).toContain("or user_id <> v_event.owner_user_id");
    expect(approve).toContain("1 + v_participant_count >= v_event.max_participants");
    expect(approve).toContain("insert into public.participants");
    expect(approve).toContain("set status = 'approved'");
    expect(approve.indexOf("Participant already exists")).toBeLessThan(
      approve.indexOf("select count(*)::integer"),
    );
    expect(approve.indexOf("select count(*)::integer")).toBeLessThan(
      approve.indexOf("insert into public.participants"),
    );
    expect(approve.indexOf("insert into public.participants")).toBeLessThan(
      approve.indexOf("set status = 'approved'"),
    );
  });

  it("counts the owner once while including ordinary and legacy participant rows", () => {
    const approve = migration.slice(
      migration.indexOf("create or replace function public.approve_join_request"),
      migration.indexOf("create or replace function public.reject_join_request"),
    );
    expect(approve).toContain("1 + v_participant_count");
    expect(approve).toContain("user_id is null");
    expect(approve).toContain("user_id <> v_event.owner_user_id");
  });

  it("uses the event lock to serialize approval of the last total-capacity seat", () => {
    const approve = migration.slice(
      migration.indexOf("create or replace function public.approve_join_request"),
      migration.indexOf("create or replace function public.reject_join_request"),
    );
    expect(approve).toMatch(
      /from public\.events\r?\n[ ]{2}where id = p_event_id\r?\n[ ]{2}for update/,
    );
    expect(approve).toContain("select count(*)::integer");
  });

  it("rejects without creating a participant", () => {
    const reject = migration.slice(
      migration.indexOf("create or replace function public.reject_join_request"),
      migration.indexOf("revoke all on function public.approve_join_request"),
    );
    expect(reject).toContain("v_event.owner_user_id <> p_actor_user_id");
    expect(reject).toContain("v_event.visibility <> 'public'");
    expect(reject).toContain("set status = 'rejected'");
    expect(reject).not.toContain("insert into public.participants");
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

  it("documents the required public saveResponse guard without changing the private flow", () => {
    expect(migration).toContain("OPEN 2 must reject saveResponse for a public event unless the caller is an");
    expect(migration).toContain("approved participant");
    expect(migration).toContain("existing private response flow intentionally stays");
  });
});
