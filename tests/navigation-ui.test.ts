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
import { readAppSource } from "./app-source";

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
  it("contains exactly Home, Open Meetings, Places and My Meetings", () => {
    expect(bottomNavigationItems).toHaveLength(4);
    expect(bottomNavigationItems.map((item) => item.label)).toEqual([
      "Главная",
      "Открытые встречи",
      "Куда сходить",
      "Мои встречи",
    ]);
    expect(bottomNavigationItems.map((item) => item.shortLabel)).toEqual([
      "Главная",
      "Открытые",
      "Места",
      "Мои",
    ]);
    expect(bottomNavigationItems.map((item) => item.label)).not.toEqual(
      expect.arrayContaining(["Создать", "Профиль", "Архив"]),
    );
  });

  it("navigates between all persistent tabs through existing paths", () => {
    const navigate = vi.fn();
    navigateToBottomItem("/open", navigate);
    navigateToBottomItem("/places", navigate);
    navigateToBottomItem("/my-events", navigate);
    navigateToBottomItem("/", navigate);
    expect(navigate.mock.calls).toEqual([
      ["/open"],
      ["/places"],
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
    expect(isBottomNavigationSelected("/places", "/places")).toBe(true);
    expect(isBottomNavigationSelected("/places", "/open")).toBe(false);
  });

  it("keeps the create button in the middle of five slots", () => {
    const navigationSource = readFileSync("src/BottomNavigation.tsx", "utf8");
    const sunset = readFileSync("src/theme-sunset.css", "utf8");
    expect(navigationSource).toContain("index === 2");
    expect(sunset).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px minmax(0, 1fr) minmax(0, 1fr);",
    );
    expect(readAppSource()).toContain('path === "/places"');
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
  const appSource = readAppSource();
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
    expect(appSource).toContain('className="topbar-settings"');
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain("--color-surface");
  });

  it("keeps role-specific meeting destinations while exposing a compact action", () => {
    expect(appSource).toContain('showAction');
    expect(appSource).toContain('item.role === "owner" ? "Управлять" : "Открыть"');
    expect(stylesSource).toContain(".meeting-card-action");
  });

  it("keeps the public feed route and removes its former Home card", () => {
    expect(appSource).toContain('path === "/open"');
    expect(appSource).toContain('<BottomNavigation currentPath="/open"');
    expect(appSource).not.toContain("className=\"home-open-meetings\"");
    expect(stylesSource).not.toContain(".home-open-meetings");
    expect(stylesSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
  });

  it("keeps one shared component tree for both Home themes", () => {
    expect(appSource).toContain('variant="home"');
    // The theme is chosen in «Настройки»; the corner button opens them.
    expect(appSource).toContain('onClick={() => navigate("/settings")}');
    expect(appSource).toContain("<Settings aria-hidden");
    expect(appSource).not.toContain("LightHome");
    expect(appSource).not.toContain("DarkHome");
  });

  it("uses the graphite and coral palette without replacing dynamic Home data", () => {
    const tokens = readFileSync("src/design-tokens.css", "utf8");
    expect(tokens).toContain("--color-bg: #f4f4f5");
    expect(tokens).toContain("--color-primary-strong: #18181b");
    expect(tokens).toContain("--color-accent: #f04438");
    expect(tokens).toContain("--color-bg: #0f0f10");
    expect(tokens).toContain("--color-primary-strong: #f4f4f5");
    expect(appSource).toContain("user.firstName");
    expect(appSource).toContain("value={meetingCount ?? undefined}");
    expect(appSource).toContain("<MeetingGroup");
    expect(appSource).not.toContain("Поездка в горы");
  });

  it("keeps the approved root and nested top-bar boundaries", () => {
    expect(appSource).toContain('title="Flockly" variant="root"');
    expect(appSource).toContain('title="Управление встречей" variant="nested"');
    expect(stylesSource).toContain(".topbar-action");
    expect(stylesSource).toContain(".topbar-title");
    expect(stylesSource).toContain("min-height: 44px;");
  });
});

describe("in-app back navigation", () => {
  const appSource = readAppSource();

  it("keeps Back separate from Home and uses a safe internal history stack", () => {
    expect(appSource).toContain("const historyStack = useRef([initialPath.current]);");
    expect(appSource).toContain("const goBack = useCallback(() => {");
    expect(appSource).toContain('navigate("/", true);');
    expect(appSource).toContain('onClick={onBack ?? (() => navigate("/"))}');
    expect(appSource).toContain("useTelegramBack(path, goBack, backOverride)");
  });

  it("passes the same safe Back action to nested screens", () => {
    expect(appSource).toContain("onBack={backOverride ?? goBack}");
    expect(appSource).toContain("onBack={goBack}");
    expect(appSource).not.toContain("onClick={() => window.history.back()}");
  });
});
