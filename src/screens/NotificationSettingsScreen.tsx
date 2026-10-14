import { useCallback, useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { api } from "../api";
import { haptic, openTelegramUrl, requestBotWriteAccess } from "../telegram";
import type { NotificationSettings } from "../types";
import { Loading, ErrorNote, RetryState } from "../ui/common";
import { t } from "../i18n";

const responseModeOptions = [
  { value: "summary", title: "Сводка раз в день", text: "Вечером одно сообщение: сколько ответили и сколько подходит время" },
  { value: "each", title: "Каждый новый ответ", text: "Сразу, но не чаще раза в 15 минут по одной встрече" },
  { value: "off", title: "Не присылать", text: "Об ответах узнаете, открыв встречу" },
] as const;

/** The notification part of «Настройки» (bot messages about meetings). */
export function NotificationSettingsPanel() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setError("");
    api.notificationSettings().then(setSettings).catch((reason) =>
      setError(reason instanceof Error ? reason.message : t("Не удалось загрузить настройки.")));
  }, []);
  useEffect(() => load(), [load]);
  const save = async (update: Parameters<typeof api.notificationSettings>[0]) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      setSettings(await api.notificationSettings(update));
      haptic();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Не удалось сохранить настройки."));
    } finally {
      setSaving(false);
    }
  };
  const allowMessages = async () => {
    const granted = await requestBotWriteAccess();
    if (granted) await save({ writeAccessGranted: true });
    else if (granted === null)
      openTelegramUrl(`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "flocklyappbot"}`);
  };
  return (
    <section aria-labelledby="settings-notifications" className="settings-section">
      <h2 id="settings-notifications">{t("Уведомления")}</h2>
      {!settings && !error && <Loading label={t("Загружаем настройки…")} />}
      {error && !settings && <RetryState message={error} onRetry={load} title={t("Настройки не загрузились")} />}
      {settings && (
        <>
          {settings.canMessage !== true && (
            <section className="settings-permission">
              <p>
                {t("Чтобы бот мог присылать уведомления, разрешите ему писать вам в личные сообщения.")}</p>
              <button className="primary-action" disabled={saving} onClick={() => void allowMessages()} type="button">
                <Bell size={18} />
                {t("Разрешить сообщения")}</button>
            </section>
          )}
          <fieldset className="visibility-selector">
            <legend>{t("Ответы на ваши встречи")}</legend>
            {responseModeOptions.map((option) => (
              <button
                aria-pressed={settings.responseMode === option.value}
                className={`visibility-option${settings.responseMode === option.value ? " selected" : ""}`}
                disabled={saving}
                key={option.value}
                onClick={() => void save({ responseMode: option.value })}
                type="button"
              >
                <span className="visibility-option-title"><strong>{t(option.title)}</strong><span className="visibility-option-mark" aria-hidden="true">{settings.responseMode === option.value && <Check size={16} />}</span></span>
                <span>{t(option.text)}</span>
              </button>
            ))}
          </fieldset>
          <fieldset className="settings-toggles">
            <legend>{t("Напоминания о встрече")}</legend>
            <label className="settings-toggle">
              <input checked={settings.reminder24h} disabled={saving} onChange={(event) => void save({ reminder24h: event.target.checked })} type="checkbox" />
              <span>{t("За 24 часа")}</span>
            </label>
            <label className="settings-toggle">
              <input checked={settings.reminder2h} disabled={saving} onChange={(event) => void save({ reminder2h: event.target.checked })} type="checkbox" />
              <span>{t("За 2 часа")}</span>
            </label>
          </fieldset>
          <p className="settings-note">
            {t("Об итоге, отмене и изменениях встреч, в которых вы участвуете, бот сообщает всегда.")}</p>
          <ErrorNote message={error} />
        </>
      )}
    </section>
  );
}
