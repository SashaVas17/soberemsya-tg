import type { MapMeeting, MapPoints, MapVenuePoint } from "./types";

// OpenFreeMap: free vector tiles without a key or an account, commercial use
// allowed (https://openfreemap.org). Another provider is a build setting.
export const MAP_STYLE_LIGHT =
  import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
export const MAP_STYLE_DARK =
  import.meta.env.VITE_MAP_STYLE_DARK_URL || "https://tiles.openfreemap.org/styles/dark";

export function mapStyleFor(theme: string | undefined) {
  return theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

export const MAP_COLORS = {
  light: { venue: "#6a3cf0", featured: "#ff9a6a", meeting: "#e8467c", stroke: "#ffffff", text: "#ffffff" },
  dark: { venue: "#b49bff", featured: "#ffb98e", meeting: "#ff6fa3", stroke: "#130a1a", text: "#130a1a" },
} as const;

type Point = { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: Record<string, string | boolean> };

export function venueFeatures(points: MapVenuePoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map(([id, latitude, longitude, categoryId, featured]): Point => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: { id, categoryId, featured },
    })),
  };
}

export function meetingFeatures(meetings: MapMeeting[]) {
  return {
    type: "FeatureCollection" as const,
    features: meetings.map((meeting): Point => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [meeting.longitude, meeting.latitude] },
      properties: { id: meeting.id },
    })),
  };
}

const meetingTime = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  // Times are shown in Minsk time across the app (see «Известные проблемы»).
  timeZone: "Europe/Minsk",
});

export function mapMeetingTime(startsAt: string | null) {
  if (!startsAt) return "";
  const date = new Date(startsAt);
  return Number.isNaN(date.getTime()) ? "" : meetingTime.format(date);
}

/**
 * The first view: all points with a margin, at most street level; the city
 * box when there are no points yet.
 */
export function initialMapBounds(points: Pick<MapPoints, "venues" | "meetings" | "bounds">): [[number, number], [number, number]] {
  const coordinates = [
    ...points.venues.map(([, latitude, longitude]) => [latitude, longitude] as const),
    ...points.meetings.map((meeting) => [meeting.latitude, meeting.longitude] as const),
  ];
  if (!coordinates.length) {
    const { west, south, east, north } = points.bounds;
    return [[west, south], [east, north]];
  }
  const latitudes = coordinates.map(([latitude]) => latitude);
  const longitudes = coordinates.map(([, longitude]) => longitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
