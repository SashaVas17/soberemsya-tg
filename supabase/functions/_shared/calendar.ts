const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function signCalendarTicket(eventId: string, expires: number, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${eventId}.${expires}`));
  return base64Url(new Uint8Array(signature));
}

export function escapeIcs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function icsDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(input: { id: string; title: string; description: string; location: string; url: string; startsAt: string }) {
  const start = new Date(input.startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const now = new Date();
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Soberemsya//Telegram Mini App//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${escapeIcs(input.id)}@soberemsya`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(input.title)}`, `DESCRIPTION:${escapeIcs(input.description)}`, `LOCATION:${escapeIcs(input.location)}`, `URL:${escapeIcs(input.url)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
