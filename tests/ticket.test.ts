import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setLanguage } from "../src/i18n";
import { ticketDate } from "../src/ticket";
import { meetingTime } from "../src/my-meetings";

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
    // Earlier today: already started or over, not «Сегодня».
    expect(ticketDate(at(22, 9, 0), now)?.soon).toBeNull();
  });

  it("dates a decided meeting by its chosen time only", () => {
    const best = { id: "b", startsAt: at(24), availableCount: 3 };
    const final = { id: "f", startsAt: at(25), availableCount: 2 };
    expect(meetingTime({ status: "decided", bestTime: best, finalTime: final })).toBe(final);
    expect(meetingTime({ status: "decided", bestTime: best, finalTime: null })).toBeNull();
    expect(meetingTime({ status: "decided", bestTime: best })).toBe(best);
    expect(meetingTime({ status: "collecting", bestTime: best, finalTime: null })).toBe(best);
    // While collecting: the popular option still ahead; none when all are past.
    const ahead = { id: "a", startsAt: at(26), availableCount: 1 };
    expect(meetingTime({ status: "collecting", bestTime: best, finalTime: null, upcomingTime: ahead })).toBe(ahead);
    expect(meetingTime({ status: "collecting", bestTime: best, finalTime: null, upcomingTime: null })).toBeNull();
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
    expect(source).toContain('<span className="sr-only">');
    expect(source).toContain('t("Пока лидирует: {time}"');
  });
});
