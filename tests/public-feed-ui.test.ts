import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergePublicMeetings } from "../src/public-feed";
import type { PublicMeetingFeedItem } from "../src/types";

const appSource = readFileSync("src/App.tsx", "utf8");
const navigationSource = readFileSync("src/BottomNavigation.tsx", "utf8");
const apiSource = readFileSync("src/api.ts", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

const item = (id: string, title = id): PublicMeetingFeedItem => ({
  id,
  title,
  description: "Описание",
  status: "collecting",
  dateSummary: "15 августа",
  budgetLimit: 40,
  participantCount: 2,
  maxParticipants: 6,
});

describe("public feed frontend contract", () => {
  it("keeps the public feed in persistent navigation and its hash route", () => {
    expect(appSource).toContain("Открытые встречи");
    expect(navigationSource).toContain("bottomNavigationItems");
    expect(appSource).toContain('path === "/open"');
  });

  it("calls the authenticated public feed endpoint with an optional cursor", () => {
    expect(apiSource).toContain("publicMeetings: (cursor?: string)");
    expect(apiSource).toContain(
      '`/public/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`',
    );
  });

  it("renders only the safe feed fields", () => {
    const feed = appSource.slice(
      appSource.indexOf("function PublicMeetings"),
      appSource.indexOf("function MeetingGroup"),
    );
    for (const field of [
      "title",
      "description",
      "dateSummary",
      "budgetLimit",
      "participantCount",
      "maxParticipants",
    ])
      expect(feed).toContain(`item.${field}`);
    for (const field of [
      "participants",
      "preferences",
      "restrictions",
      "joinRequest",
      "ownerUserId",
      "userId",
      "votes",
    ])
      expect(feed).not.toContain(`item.${field}`);
  });

  it("provides loading, empty and retry states", () => {
    expect(appSource).toContain("Загружаем открытые встречи…");
    expect(appSource).toContain("Пока нет открытых встреч");
    expect(appSource).toContain("Не удалось загрузить открытые встречи.");
    expect(appSource).toContain("onRetry={() => void load()}");
  });

  it("shows and disables the explicit pagination action while loading", () => {
    expect(appSource).toContain("Загрузить ещё");
    expect(appSource).toContain("disabled={loadingMore}");
    expect(appSource).toContain("load(nextCursor)");
  });

  it("appends pages and removes duplicate event ids", () => {
    expect(
      mergePublicMeetings(
        [item("one")],
        [item("two"), item("one", "updated")],
      ),
    ).toEqual([item("one", "updated"), item("two")]);
  });

  it("keeps existing cards when a pagination request fails", () => {
    const feed = appSource.slice(
      appSource.indexOf("function PublicMeetings"),
      appSource.indexOf("function MeetingGroup"),
    );
    expect(feed).toContain(
      "setItems((current) => mergePublicMeetings(current, result.items))",
    );
    expect(feed).toContain("{error && items.length > 0");
    expect(feed).toContain("{cards}");
  });

  it("uses the existing event/public-preview flow for card clicks", () => {
    expect(appSource).toContain("navigate(`/event/${item.id}`)");
    expect(appSource).toContain("publicEventPreview(eventId)");
    expect(appSource).toContain('<span className="meeting-card-action">Подробнее</span>');
  });

  it("does not alter the existing meeting navigation contract", () => {
    expect(appSource).toContain('path === "/my-events"');
    expect(appSource).toContain("meetingDestination(item)");
    expect(appSource).toContain("navigate(`/result/${event.id}`)");
  });

  it("keeps the new screen on existing neutral/card styling", () => {
    expect(stylesSource).toContain(".public-meeting-card");
    expect(stylesSource).toContain(".public-feed-load-more");
    expect(stylesSource).not.toContain(".public-meeting-card .primary-action");
  });
});
