export type Point = { latitude: number; longitude: number };

// The same bounds as POINT_BOUNDS in supabase/functions/_shared/venues.ts
// (Belarus with a margin); tests/venues.test.ts keeps them equal.
export const POINT_BOUNDS = { south: 51.0, north: 56.5, west: 23.0, east: 33.0 } as const;

const pair = /^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/;

/**
 * "53.9037, 27.5562" as copied from OpenStreetMap, Google or Yandex Maps
 * (latitude first; a decimal comma and a space or semicolon between the
 * numbers work too). Empty text means "no point" (null); a text that is not a
 * point of Belarus is "invalid".
 */
export function parsePoint(text: string): Point | null | "invalid" {
  const value = text.trim();
  if (!value) return null;
  const match = pair.exec(value);
  if (!match) return "invalid";
  const latitude = Number(match[1].replace(",", "."));
  const longitude = Number(match[2].replace(",", "."));
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < POINT_BOUNDS.south || latitude > POINT_BOUNDS.north ||
    longitude < POINT_BOUNDS.west || longitude > POINT_BOUNDS.east
  ) return "invalid";
  return { latitude, longitude };
}

export function formatPoint(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** OpenStreetMap with a marker, to check the point before saving. */
export function pointMapUrl({ latitude, longitude }: Point) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;
}
