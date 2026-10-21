import { Check, Send } from "lucide-react";
import { managementPath } from "../meeting-links";
import type { EventData } from "../types";
import type { Navigate, CreatedGroup } from "../app-types";
import { Header } from "../ui/common";
import { miniAppLink, usePreparedShare, shareEvent } from "../share";
import { t } from "../i18n";

export function Created({
  eventId,
  navigate,
  event,
  group,
  onBack,
}: {
  eventId: string;
  navigate: Navigate;
  event: EventData | null;
  group: CreatedGroup | null;
  onBack: () => void;
}) {
  const link = miniAppLink(eventId);
  const invitePrepared = usePreparedShare(eventId, "invite");
  const chat = group?.chatTitle ? t("в чате «{chat}»", { chat: group.chatTitle }) : t("в чате");
  return (
    <main className="created-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Встреча создана")} variant="nested" />
      <section className="created-page">
        <span className="created-success-icon"><Check size={52} strokeWidth={2.4} /></span>
        <div className="created-copy">
          <h1>{t("Встреча создана")}</h1>
          {event?.visibility === "public" && <span className="visibility-badge">{t("Открытая")}</span>}
          <p>{t("Всё готово! Теперь можно приглашать друзей.")}</p>
          {group?.attached && (
            <p className="group-create-note">{t("Карточка встречи появится")} {chat}  {t("в течение минуты.")}</p>
          )}
          {group && !group.attached && (
            <p className="group-create-note group-create-note-error">
              {t("Не удалось опубликовать встречу")} {chat}{t(". Отправьте приглашение вручную.")}</p>
          )}
        </div>
        <div className="created-link-card">
          <span>{t("Ссылка-приглашение")}</span>
          <code>{link}</code>
        </div>
        <div className="created-actions">
          <button
            className="primary-action"
            onClick={() => shareEvent(eventId, invitePrepared)}
            type="button"
          >
            <Send size={20} />
            {t("Поделиться в Telegram")}</button>
          <button
            className="secondary-action"
            onClick={() => navigate(managementPath(eventId))}
            type="button"
          >
            {t("Перейти к встрече")}</button>
        </div>
      </section>
    </main>
  );
}
