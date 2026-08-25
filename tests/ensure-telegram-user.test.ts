import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260825120742_ensure_telegram_user.sql",
  "utf8",
);
const hotfixMigration = readFileSync(
  "supabase/migrations/20260825122438_fix_ensure_telegram_user_conflict.sql",
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

  it("leaves the canonical migration untouched", () => {
    expect(migration).toContain("on conflict (telegram_user_id) do nothing");
  });

  it("uses the named unique constraint in the replacement function", () => {
    expect(hotfixMigration).toContain(
      "on conflict on constraint users_telegram_user_id_key do nothing",
    );
    expect(hotfixMigration).not.toContain("on conflict (telegram_user_id) do nothing");
  });

  it("preserves the RPC signature, return shape, and conflict resolution", () => {
    for (const source of [migration, hotfixMigration]) {
      expect(source).toContain("create or replace function public.ensure_telegram_user(");
      for (const parameter of [
        "p_telegram_user_id bigint",
        "p_username text",
        "p_first_name text",
        "p_last_name text",
        "p_language_code text",
        "p_photo_url text",
      ]) expect(source).toContain(parameter);
      expect(source).toContain("returns table (");
      for (const field of ["id uuid", "telegram_user_id text", "username text", "first_name text", "last_name text", "photo_url text"])
        expect(source).toContain(field);
    }
    expect(migration).toContain("where user_profile.telegram_user_id = p_telegram_user_id");
    expect(hotfixMigration).toContain("where user_profile.telegram_user_id = p_telegram_user_id");
    expect(hotfixMigration).toContain("for update;");
    expect(hotfixMigration).toContain("v_user.telegram_user_id::text");
  });

  it("preserves conditional updates only when nullable Telegram profile values differ", () => {
    for (const field of ["username", "first_name", "last_name", "language_code", "photo_url"])
      expect(hotfixMigration).toContain(`v_user.${field} is distinct from p_${field}`);
    const unchangedGuard = hotfixMigration.slice(
      hotfixMigration.indexOf("if v_user.username is distinct from"),
      hotfixMigration.indexOf("end if;\n  end if;"),
    );
    expect(unchangedGuard).toContain("update public.users");
    expect(unchangedGuard).toContain("updated_at = now()");
    expect(hotfixMigration).not.toContain("created_at =");
    expect(hotfixMigration).not.toContain("set telegram_user_id =");
  });

  it("has no update statement outside the profile-change branch", () => {
    expect(hotfixMigration.match(/update public\.users/g)).toHaveLength(1);
    expect(hotfixMigration.indexOf("if v_user.username is distinct from")).toBeLessThan(
      hotfixMigration.indexOf("update public.users"),
    );
  });

  it("preserves SECURITY DEFINER and service-role-only grants in the replacement", () => {
    expect(hotfixMigration).toContain("security definer");
    expect(hotfixMigration).toContain("set search_path = pg_catalog, public");
    for (const role of ["public", "anon", "authenticated"])
      expect(hotfixMigration).toContain(
        `revoke all on function public.ensure_telegram_user(bigint, text, text, text, text, text) from ${role};`,
      );
    expect(hotfixMigration).toContain(
      "grant execute on function public.ensure_telegram_user(bigint, text, text, text, text, text)\n  to service_role;",
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
