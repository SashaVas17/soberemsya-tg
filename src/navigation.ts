import type { MeetingListItem } from "./types";

// Five slots keep the create button in the middle: two tabs, create, two tabs.
// shortLabel is shown under the icon; label is the full accessible name.
export const bottomNavigationItems = [
  { id: "home", label: "Главная", shortLabel: "Главная", path: "/" },
  { id: "open", label: "Открытые встречи", shortLabel: "Открытые", path: "/open" },
  { id: "places", label: "Куда сходить", shortLabel: "Места", path: "/places" },
  { id: "meetings", label: "Мои встречи", shortLabel: "Мои", path: "/my-events" },
] as const;

export type BottomNavigationPath =
  (typeof bottomNavigationItems)[number]["path"];

export function isBottomNavigationSelected(
  currentPath: string,
  itemPath: BottomNavigationPath,
) {
  return currentPath === itemPath;
}

export function navigateToBottomItem(
  path: BottomNavigationPath,
  navigate: (path: string) => void,
) {
  navigate(path);
}

export function meetingDestination(
  meeting: Pick<MeetingListItem, "id" | "role">,
) {
  return meeting.role === "owner"
    ? `/manage/${meeting.id}`
    : `/event/${meeting.id}`;
}

export function meetingCardData(
  meeting: Pick<
    MeetingListItem,
    "title" | "status" | "timeSummary" | "placeSummary" | "responseCount"
  >,
) {
  return {
    title: meeting.title,
    status: meeting.status,
    timeSummary: meeting.timeSummary,
    placeSummary: meeting.placeSummary,
    responseCount: meeting.responseCount,
  };
}
