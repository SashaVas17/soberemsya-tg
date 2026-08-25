import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260825120742_ensure_telegram_user.sql",
  "utf8",
);
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const authenticate = api.slice(
  api.indexOf("async function authenticate"),
  api.indexOf("async function health"),
);

describe("ensure_telegram_user migration", () => {
  it("creates a service-role-only SECURITY DEFINER RPC", () => {
    expect(migration).toContain("create or replace function public.ensure_telegram_user(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, public");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(
        `revoke all on function public.ensure_telegram_user(bigint, text, text, text, text, text) from ${role};`,
      );
    expect(migration).toContain(
      "grant execute on function public.ensure_telegram_user(bigint, text, text, text, text, text)\n  to service_role;",
    );
  });

  it("uses only trusted Telegram profile inputs and returns the existing auth shape", () => {
    for (const parameter of [
      "p_telegram_user_id bigint",
      "p_username text",
      "p_first_name text",
      "p_last_name text",
      "p_language_code text",
      "p_photo_url text",
    ]) expect(migration).toContain(parameter);
    for (const field of ["id uuid", "telegram_user_id text", "username text", "first_name text", "last_name text", "photo_url text"])
      expect(migration).toContain(field);
    expect(migration).not.toContain("p_actor_user_id");
    expect(migration).not.toContain("p_event_id");
    expect(migration).not.toContain("p_init_data");
  });

  it("inserts once and resolves concurrent conflicts through the existing unique key", () => {
    expect(migration).toContain("on conflict (telegram_user_id) do nothing");
    expect(migration).toContain("where user_profile.telegram_user_id = p_telegram_user_id");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_user.telegram_user_id::text");
  });

  it("updates only when nullable Telegram profile values actually differ", () => {
    for (const field of ["username", "first_name", "last_name", "language_code", "photo_url"])
      expect(migration).toContain(`v_user.${field} is distinct from p_${field}`);
    const unchangedGuard = migration.slice(
      migration.indexOf("if v_user.username is distinct from"),
      migration.indexOf("end if;\n  end if;"),
    );
    expect(unchangedGuard).toContain("update public.users");
    expect(unchangedGuard).toContain("updated_at = now()");
    expect(migration).not.toContain("created_at =");
    expect(migration).not.toContain("set telegram_user_id =");
  });

  it("has no update statement outside the profile-change branch", () => {
    expect(migration.match(/update public\.users/g)).toHaveLength(1);
    expect(migration.indexOf("if v_user.username is distinct from")).toBeLessThan(
      migration.indexOf("update public.users"),
    );
  });
});

describe("telegram-api conditional user ensure", () => {
  it("replaces the direct users upsert with exactly one ensure RPC", () => {
    expect(authenticate).not.toContain('db.from("users").upsert');
    expect(authenticate.match(/db\.rpc\("ensure_telegram_user"/g)).toHaveLength(1);
    expect(authenticate).toContain(".single<AppUser>()");
  });

  it("calls the RPC only after Telegram validation and supplies trusted profile fields", () => {
    expect(authenticate.indexOf("validateTelegramInitData(")).toBeLessThan(
      authenticate.indexOf('db.rpc("ensure_telegram_user"'),
    );
    for (const field of [
      "p_telegram_user_id: profile.id",
      "p_username: profile.username ?? null",
      "p_first_name: profile.first_name",
      "p_last_name: profile.last_name ?? null",
      "p_language_code: profile.language_code ?? null",
      "p_photo_url: profile.photo_url ?? null",
    ]) expect(authenticate).toContain(field);
    expect(authenticate).not.toContain("payload.userId");
    expect(authenticate).not.toContain("requesterUserId");
  });

  it("keeps the external authenticated actor shape and safe failure behavior", () => {
    expect(authenticate).toContain("return { user: data, startParam: validated.startParam };");
    expect(authenticate).toContain("telegram_user_ensure_failed");
    expect(authenticate).toContain("Не удалось сохранить пользователя Telegram.");
  });
});
