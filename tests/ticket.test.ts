import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setLanguage } from "../src/i18n";
import { ticketDate } from "../src/ticket";

// Local times, so the day maths does not depend on the machine's time zone.
const now = new Date(2026, 9, 22, 10, 0);
const at = (day: number, hour = 18, minute = 30) => new Date(2026, 9, day, hour, minute).toISOString();

afterEach(() => setLanguage("ru"));

describe("ticket date", () => {
  it("shows the day, short month and weekday without trailing dots", () => {
    const date = ticketDate(at(24), now)!;
    expect(date.day).toBe("24");
    expect(date.month).not.toMatch(/\.$/);
    expect(date.weekday).not.toMatch(/\.$/);
    expect(date.time).toBe("18:30");
  });

  it("says how soon the meeting is", () => {
    expect(ticketDate(at(22, 23), now)?.soon).toBe("Сегодня");
    expect(ticketDate(at(23, 0, 5), now)?.soon).toBe("Завтра");
    expect(ticketDate(at(24), now)?.soon).toBe("Через 2 дня");
    expect(ticketDate(at(27), now)?.soon).toBe("Через 5 дней");
    expect(ticketDate(at(21), now)?.soon).toBeNull();
  });

  it("speaks English too", () => {
    setLanguage("en");
    expect(ticketDate(at(24), now)?.soon).toBe("In 2 days");
    expect(ticketDate(at(23), now)?.soon).toBe("Tomorrow");
  });

  it("ignores an unreadable date", () => {
    expect(ticketDate("not a date", now)).toBeNull();
  });

  it("dates cards by the chosen time and keeps the full date for screen readers", () => {
    const source = readFileSync("src/ui/common.tsx", "utf8");
    expect(source).toContain('className="meeting-card meeting-ticket"');
    expect(source).toContain("const time = meetingTime(item);");
    expect(source).toContain('<span className="sr-only">{formatSlot(time.startsAt)}</span>');
  });
});
