import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260811181309_open_meetings_foundation.sql",
  "utf8",
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
