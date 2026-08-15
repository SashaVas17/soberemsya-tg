import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bottomNavigationItems,
  isBottomNavigationSelected,
  meetingCardData,
  meetingDestination,
  navigateToBottomItem,
} from "../src/navigation";
import type { MeetingListItem } from "../src/types";

const meeting: MeetingListItem = {
  id: "evt_123",
  title: "Шашлыки с друзьями",
  status: "collecting",
  role: "owner",
  participantCount: 3,
  responseCount: 3,
  bestTime: null,
  timeSummary: "9–10 августа",
  placeSummary: "Парк",
  createdAt: "2026-08-09T12:00:00.000Z",
};

describe("primary frontend navigation", () => {
  it("contains exactly Home, Open Meetings and My Meetings", () => {
    expect(bottomNavigationItems).toHaveLength(3);
    expect(bottomNavigationItems.map((item) => item.label)).toEqual([
      "Главная",
      "Открытые встречи",
      "Мои встречи",
    ]);
    expect(bottomNavigationItems.map((item) => item.label)).not.toEqual(
      expect.arrayContaining(["Создать", "Профиль", "Архив"]),
    );
  });

  it("navigates between all persistent tabs through existing paths", () => {
    const navigate = vi.fn();
    navigateToBottomItem("/open", navigate);
    navigateToBottomItem("/my-events", navigate);
    navigateToBottomItem("/", navigate);
    expect(navigate.mock.calls).toEqual([
      ["/open"],
      ["/my-events"],
      ["/"],
    ]);
  });

  it("selects the item matching the current route", () => {
    expect(isBottomNavigationSelected("/", "/")).toBe(true);
    expect(isBottomNavigationSelected("/", "/open")).toBe(false);
    expect(isBottomNavigationSelected("/", "/my-events")).toBe(false);
    expect(isBottomNavigationSelected("/open", "/open")).toBe(true);
    expect(isBottomNavigationSelected("/open", "/")).toBe(false);
    expect(isBottomNavigationSelected("/my-events", "/my-events")).toBe(true);
  });

  it("opens owner and participant meetings through stable routes", () => {
    expect(meetingDestination(meeting)).toBe("/manage/evt_123");
    expect(meetingDestination({ ...meeting, role: "participant" })).toBe(
      "/event/evt_123",
    );
  });

  it("builds cards only from the existing meeting summary contract", () => {
    expect(meetingCardData(meeting)).toEqual({
      title: "Шашлыки с друзьями",
      status: "collecting",
      timeSummary: "9–10 августа",
      placeSummary: "Парк",
      responseCount: 3,
    });
  });
});

describe("meeting list architecture", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const apiSource = readFileSync("src/api.ts", "utf8");
  const stylesSource = readFileSync("src/styles.css", "utf8");

  it("keeps Loading, EmptyState and RetryState in list screens", () => {
    expect(appSource).toContain("<Loading");
    expect(appSource).toContain("<EmptyState");
    expect(appSource).toContain("<RetryState");
    expect(appSource).toContain("onRetry={() => void load()}");
  });

  it("loads lists through /me/meetings without per-event requests", () => {
    const meetingsApi = apiSource.slice(
      apiSource.indexOf("meetings: () =>"),
      apiSource.indexOf("manage: (id:"),
    );
    expect(meetingsApi).toContain('"/me/meetings"');
    expect(meetingsApi).not.toContain("/events/");
  });

  it("keeps the Phase A theme toggle and token-based shared structure", () => {
    const tokens = readFileSync("src/design-tokens.css", "utf8");
    expect(appSource).toContain('className="theme-toggle"');
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain("--color-surface");
  });

  it("keeps the public feed route and removes its former Home card", () => {
    expect(appSource).toContain('path === "/open"');
    expect(appSource).toContain('<BottomNavigation currentPath="/open"');
    expect(appSource).not.toContain("className=\"home-open-meetings\"");
    expect(stylesSource).not.toContain(".home-open-meetings");
    expect(stylesSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
  });
});
