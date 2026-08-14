import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildIcs, isCalendarTicketValid, signCalendarTicket } from "../supabase/functions/_shared/calendar";

const edgeApi = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const frontendApi = readFileSync("src/api.ts", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");

describe("secure calendar links", () => {
  it("signs a short-lived event ticket without exposing its secret", async () => {
    const secret = "not-for-a-url";
    const ticket = await signCalendarTicket("evt_123", 1_785_000_000, secret);

    expect(ticket).not.toContain(secret);
    await expect(isCalendarTicketValid("evt_123", 1_785_000_000, ticket, secret, 1_784_999_999)).resolves.toBe(true);
    await expect(isCalendarTicketValid("evt_123", 1_785_000_000, `${ticket}x`, secret, 1_784_999_999)).resolves.toBe(false);
    await expect(isCalendarTicketValid("evt_123", 1_785_000_000, ticket, secret, 1_785_000_000)).resolves.toBe(false);
  });

  it("builds a CRLF UTF-8 calendar event with complete final details", () => {
    const ics = buildIcs({
      id: "evt_123",
      title: "Встреча, друзья",
      description: "Возьмите воду; без стекла",
      location: "Минск\nПарк",
      url: "https://t.me/soberemsyabelarusbot/soberemsya?startapp=event_evt_123",
      startsAt: "2026-08-15T16:00:00.000Z",
    });

    expect(ics).toContain("\r\n");
    expect(ics).toContain("UID:evt_123@soberemsya");
    expect(ics).toContain("DTSTART:20260815T160000Z");
    expect(ics).toContain("DTEND:20260815T180000Z");
    expect(ics).toContain("SUMMARY:Встреча\\, друзья");
    expect(ics).toContain("DESCRIPTION:Возьмите воду\\; без стекла");
    expect(ics).toContain("LOCATION:Минск\\nПарк");
    expect(ics).toContain("URL:https://t.me/soberemsyabelarusbot/soberemsya?startapp=event_evt_123");
  });

  it("keeps calendar-link behind current Telegram auth and full-event access", () => {
    const authIndex = edgeApi.indexOf("const auth = await authenticate(request);");
    const routeIndex = edgeApi.indexOf("calendarLinkMatch");

    expect(authIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(edgeApi).toContain("fullEventForRequest(eventId, auth.user.id)");
    expect(edgeApi).toContain("TELEGRAM_CALENDAR_SIGNING_SECRET");
    expect(edgeApi).toContain("+ 10 * 60");
  });

  it("serves only validated signed ICS downloads and keeps the secret server-side", () => {
    expect(edgeApi).toContain("isCalendarTicketValid(eventId, expires, signature, calendarSigningSecret)");
    expect(edgeApi).toContain('"content-type": "text/calendar; charset=utf-8"');
    expect(edgeApi).toContain('"content-disposition": "attachment; filename=\\"soberemsya.ics\\""');
    expect(edgeApi).toContain('"cache-control": "private, no-store"');
    expect(frontendApi).toContain("/calendar-link");
    expect(frontendApi).not.toContain("TELEGRAM_CALENDAR_SIGNING_SECRET");
    expect(appSource).not.toContain("TELEGRAM_CALENDAR_SIGNING_SECRET");
  });
});
