import { t } from "./i18n";

/**
 * A link to the meeting. A person's link carries their referral code,
 * event_<id>__r<code>, so the statistics can tell who brings new people.
 * Same format on the server: supabase/functions/_shared/domain.ts.
 */
export function miniAppLink(
  eventId: string,
  bot: string,
  app: string,
  referralCode: string | null = null,
) {
  return `https://t.me/${bot}/${app}?startapp=event_${eventId}${referralCode ? `__r${referralCode}` : ""}`;
}

/** The meeting an event_ link opens, without the referral code (even a damaged one). */
export function startParamEventId(startParam: string) {
  const match = startParam.match(/^event_([A-Za-z0-9_-]{3,80}?)(?:__r[A-Za-z0-9_-]*)?$/);
  return match ? match[1] : null;
}

export function managementPath(eventId: string) {
  return `/manage/${eventId}`;
}

export function eventShareUrl(eventId: string, bot: string, app: string, referralCode: string | null = null) {
  const link = miniAppLink(eventId, bot, app, referralCode);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t("Соберёмся?\nПроголосуйте за удобное время и место:"))}`;
}

export function resultShareUrl(eventId: string, bot: string, app: string, referralCode: string | null = null) {
  const link = miniAppLink(eventId, bot, app, referralCode);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t("Итог встречи в Flockly:"))}`;
}
