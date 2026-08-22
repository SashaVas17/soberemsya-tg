import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260822114700_schedule_event_auto_archive.sql",
  "utf8",
).replace(/\r\n/g, "\n");

describe("event auto-archive scheduler migration", () => {
  it("creates exactly one stable hourly pg_cron job", () => {
    expect(migration.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(migration).toContain("'archive-completed-events-hourly'");
    expect(migration).toMatch(/'\d{1,2} \* \* \* \*'/);
  });

  it("runs only the internal archive function through the cron command", () => {
    expect(migration.match(/SELECT public\.archive_completed_events\(\);/g)).toHaveLength(1);
    expect(migration).toMatch(
      /cron\.schedule\([\s\S]*?'SELECT public\.archive_completed_events\(\);'[\s\S]*?\);/,
    );
  });

  it("does not add networking, secrets, edge scheduling or physical deletion", () => {
    expect(migration).not.toMatch(/pg_net|vault|secret|https?:|edge function/i);
    expect(migration).not.toMatch(/delete\s+from/i);
    expect(migration).not.toMatch(/cron\.(alter_job|unschedule)/);
  });
});
