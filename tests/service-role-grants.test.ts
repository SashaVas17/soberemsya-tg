import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// In this project new tables do not give the service role any data
// privileges by default (default ACL: TRUNCATE/REFERENCES/TRIGGER only), so
// every table an Edge Function reads directly needs an explicit grant.
// Missing one broke the open meetings feed after the cities release.

function functionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return functionSources(path);
    return entry.name.endsWith(".ts") ? [readFileSync(path, "utf8")] : [];
  });
}

const tablesReadDirectly = [
  ...new Set(
    functionSources("supabase/functions").flatMap((source) =>
      [...source.matchAll(/\bdb\s*\.from\("([a-z_]+)"\)/g)].map((match) => match[1]),
    ),
  ),
].sort();

const grants = readdirSync("supabase/migrations")
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n")
  .match(/grant\s[^;]*\bto\s+service_role\s*;/gi) ?? [];

describe("service role table privileges", () => {
  it("finds the tables Edge Functions read directly", () => {
    expect(tablesReadDirectly).toEqual(expect.arrayContaining(["cities", "events", "place_votes", "users"]));
  });

  it("grants every directly read table to the service role in a migration", () => {
    const missing = tablesReadDirectly.filter(
      (table) =>
        !grants.some(
          (grant) =>
            /\bselect\b/i.test(grant) &&
            new RegExp(`\\bpublic\\.${table}\\b`).test(grant),
        ),
    );
    expect(missing).toEqual([]);
  });
});
