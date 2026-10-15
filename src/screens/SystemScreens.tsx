import { CircleAlert } from "lucide-react";
import { openTelegramUrl, telegram } from "../telegram";
import { t } from "../i18n";

export function SessionExpired() {
  const app = telegram();
  return (
    <main className="outside-screen">
      <section className="state-card error-state" role="alert">
        <span className="state-icon error-state-icon"><CircleAlert size={30} /></span>
        <div className="state-copy">
          <strong>{t("Сессия Telegram устарела")}</strong>
          <p>
            {t("Закройте Flockly и откройте снова — Telegram обновит данные входа. Несохранённые изменения на этом экране пропадут.")}</p>
          <button
            className="primary-action"
            onClick={() => (app ? app.close() : window.location.reload())}
            type="button"
          >
            {app ? t("Закрыть приложение") : t("Перезагрузить")}
          </button>
        </div>
      </section>
    </main>
  );
}

export function OutsideTelegram() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "";
  return (
    <main className="outside-screen">
      <section className="home-preview">
        <span>Telegram Mini App</span>
        <h1>Flockly</h1>
        <p>
          {t("Откройте приложение через Telegram, чтобы создавать встречи и голосовать вместе.")}</p>
        <button
          className="secondary-action"
          disabled={!bot}
          onClick={() => openTelegramUrl(`https://t.me/${bot}`)}
          type="button"
        >
          {t("Открыть в Telegram")}</button>
      </section>
    </main>
  );
}
