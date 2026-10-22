import { useEffect, useState } from "react";
import { api } from "./api";
import {
  eventShareUrl as buildEventShareUrl,
  miniAppLink as buildMiniAppLink,
  resultShareUrl as buildResultShareUrl,
} from "./meeting-links";
import { canShareMessage, openTelegramUrl, shareTelegramMessage } from "./telegram";

function telegramAppConfig() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "BOT_USERNAME";
  const app = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME || "app";
  return { bot, app };
}

// The signed-in person's referral code (from /telegram/auth): the links they
// share carry it. Null until sign-in or on an old server. The format is
// checked like on the server (REFERRAL_CODE in _shared/domain.ts).
let referralCode: string | null = null;

export function setReferralCode(code: string | null | undefined) {
  referralCode = code && /^[0-9a-f]{12}$/.test(code) ? code : null;
}

export function miniAppLink(eventId: string) {
  const { bot, app } = telegramAppConfig();
  return buildMiniAppLink(eventId, bot, app, referralCode);
}

// Prepares the card (WebApp.shareMessage) when the screen opens, so a tap
// opens Telegram's share dialog at once: a call made after a network round
// trip can lose the user gesture and be ignored by the client.
export function usePreparedShare(eventId: string | null, kind: "invite" | "result") {
  const [prepared, setPrepared] = useState<{ key: string; id: string } | null>(null);
  const key = eventId ? `${kind}:${eventId}` : "";
  useEffect(() => {
    if (!eventId || !canShareMessage()) return;
    let active = true;
    api.prepareShareMessage(eventId, kind)
      .then(({ preparedMessageId }) => {
        if (active) setPrepared({ key: `${kind}:${eventId}`, id: preparedMessageId });
      })
      .catch(() => {
        // The plain share link is used instead.
      });
    return () => { active = false; };
  }, [eventId, kind]);
  return prepared?.key === key ? prepared.id : null;
}

// A card with a button when it is ready; otherwise the plain share link.
// Analytics records a sent card or an opened share link; it never blocks sharing.
function shareCard(eventId: string, preparedMessageId: string | null, fallbackUrl: string) {
  const openFallback = () => {
    openTelegramUrl(fallbackUrl);
    void api.trackEvent("share_fallback", eventId).catch(() => undefined);
  };
  if (!preparedMessageId) {
    openFallback();
    return;
  }
  void shareTelegramMessage(preparedMessageId).then((sent) => {
    if (sent === null) openFallback();
    else if (sent) void api.trackEvent("share_sent", eventId).catch(() => undefined);
  });
}

export function shareEvent(eventId: string, preparedMessageId: string | null) {
  const { bot, app } = telegramAppConfig();
  shareCard(eventId, preparedMessageId, buildEventShareUrl(eventId, bot, app, referralCode));
}

export function shareResult(eventId: string, preparedMessageId: string | null) {
  const { bot, app } = telegramAppConfig();
  shareCard(eventId, preparedMessageId, buildResultShareUrl(eventId, bot, app, referralCode));
}
