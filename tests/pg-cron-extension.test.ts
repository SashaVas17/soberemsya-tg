import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260822142000_enable_pg_cron.sql",
  "utf8",
).replace(/\r\n/g, "\n");

describe("pg_cron infrastructure migration", () => {
  it("enables only the supported pg_cron extension and its postgres access", () => {
    expect(migration).toContain("create extension if not exists pg_cron with schema pg_catalog;");
    expect(migration).toContain("grant usage on schema cron to postgres;");
    expect(migration).toContain("grant all privileges on all tables in schema cron to postgres;");
  });

  it("does not schedule or run archival work", () => {
    expect(migration).not.toContain("cron.schedule");
    expect(migration).not.toContain("archive_completed_events");
    expect(migration).not.toContain("cron.alter_job");
    expect(migration).not.toContain("cron.unschedule");
  });

  it("does not add networking, Vault, secrets or application behavior", () => {
    expect(migration).not.toMatch(/pg_net|vault|secret|http/i);
  });
});
