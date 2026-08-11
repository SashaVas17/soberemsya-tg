export function miniAppLink(
  eventId: string,
  bot: string,
  app: string,
) {
  return `https://t.me/${bot}/${app}?startapp=event_${eventId}`;
}

export function managementPath(eventId: string) {
  return `/manage/${eventId}`;
}

export function eventShareUrl(eventId: string, bot: string, app: string) {
  const link = miniAppLink(eventId, bot, app);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Соберёмся?\nПроголосуйте за удобное время и место:")}`;
}

export function resultShareUrl(eventId: string, bot: string, app: string) {
  const link = miniAppLink(eventId, bot, app);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Итог встречи в «Соберёмся»:")}`;
}
