import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../csp.ts";
import { json } from "../supabase/functions/_shared/http.ts";
import { timingSafeEqual } from "../supabase/functions/_shared/telegram.ts";

const read = (path: string) => readFileSync(path, "utf8");
const workflowNames = readdirSync(".github/workflows").filter((name) => name.endsWith(".yml"));
const workflows = Object.fromEntries(workflowNames.map((name) => [name, read(`.github/workflows/${name}`)]));
const capMigrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_analytics_user_cap.sql"));

describe("CI supply chain", () => {
  it("pins every action to a full commit SHA", () => {
    for (const [name, text] of Object.entries(workflows)) {
      for (const [, action] of text.matchAll(/uses:\s*(\S+)/g))
        expect(action, `${name}: ${action}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("pins the Supabase CLI and keeps checkout credentials out of the workspace", () => {
    expect(workflows["deploy-functions.yml"]).not.toMatch(/version:\s*latest/);
    for (const text of Object.values(workflows)) {
      const checkouts = text.match(/uses: actions\/checkout@/g)?.length ?? 0;
      const persisted = text.match(/persist-credentials: false/g)?.length ?? 0;
      expect(persisted).toBe(checkouts);
    }
  });

  it("gives the Supabase token only to the deploy step", () => {
    const text = workflows["deploy-functions.yml"];
    expect(text.match(/secrets\.SUPABASE_ACCESS_TOKEN/g)).toHaveLength(1);
    const deployStep = text.slice(text.indexOf("- name: Deploy functions"));
    expect(deployStep).toContain("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}");
  });

  it("grants Pages write rights only to the deploy job and never builds mock mode", () => {
    const text = workflows["deploy-pages.yml"];
    const topLevel = text.slice(0, text.indexOf("jobs:"));
    expect(topLevel).not.toContain("pages: write");
    expect(topLevel).not.toContain("id-token: write");
    expect(text.slice(text.indexOf("  deploy:"))).toContain("pages: write");
    expect(text).toContain('VITE_USE_MOCK_API: "false"');
    expect(text).toContain('VITE_USE_MOCK_TELEGRAM: "false"');
    expect(text).toContain('VITE_MOCK_INIT_DATA: ""');
  });

  it("keeps CI without repository secrets", () => {
    expect(workflows["ci.yml"]).not.toContain("secrets.");
    expect(workflows["ci.yml"]).not.toContain("pull_request_target");
  });
});

describe("Edge Function secrets and headers", () => {
  it("compares the webhook secret in constant time", () => {
    const bot = read("supabase/functions/telegram-bot/index.ts");
    expect(bot).toContain('timingSafeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret)');
    expect(bot).not.toMatch(/x-telegram-bot-api-secret-token"\)\s*!==/);
    expect(timingSafeEqual("secret", "secret")).toBe(true);
    expect(timingSafeEqual("secret", "secreT")).toBe(false);
    expect(timingSafeEqual("", "secret")).toBe(false);
  });

  it("marks API answers as nosniff and keeps extra headers", () => {
    const response = json({ ok: true }, 405, { allow: "POST" });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("Content-Security-Policy of the build", () => {
  const policy = contentSecurityPolicy({
    VITE_SERVER_FUNCTION_URL: "https://project.supabase.co/functions/v1/telegram-api",
    VITE_MAP_STYLE_URL: "not a url",
  });
  const directive = (name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

  it("allows scripts only from the app and Telegram, never inline or eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' https://telegram.org");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
  });

  it("connects only to the API origin and the map tiles", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org https://project.supabase.co");
  });

  it("is added to the production build only", () => {
    const config = read("vite.config.ts");
    expect(config).toContain('apply: "build"');
    expect(config).toContain('"http-equiv": "Content-Security-Policy"');
  });
});

describe("analytics cap migration", () => {
  it("exists and keeps the function server-only", () => {
    expect(capMigrationName).toBeDefined();
    const sql = read(`supabase/migrations/${capMigrationName}`);
    expect(sql).toContain("create index if not exists analytics_events_user_created_idx");
    expect(sql).toContain("limit 200");
    expect(sql).toContain(") < 200);");
    expect(sql).toContain("security definer set search_path = pg_catalog, public");
    expect(sql).toContain("revoke all on function public.record_analytics_event(text, uuid, text, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.record_analytics_event(text, uuid, text, text) to service_role;");
    // The connector hangs on destructive statements (see CLAUDE.md).
    expect(sql).not.toMatch(/\b(drop|delete from|raise)\b/i);
  });
});
