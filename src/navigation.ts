import type { MeetingListItem } from "./types";

export const bottomNavigationItems = [
  { id: "home", label: "Главная", path: "/" },
  { id: "meetings", label: "Мои встречи", path: "/my-events" },
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
