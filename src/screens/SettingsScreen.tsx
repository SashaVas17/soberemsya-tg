import { useEffect } from "react";
import { Check } from "lucide-react";
import type { Navigate } from "../app-types";
import { language, t, type LanguagePreference } from "../i18n";
import type { ThemePreference } from "../theme";
import { Header } from "../ui/common";
import { NotificationSettingsPanel } from "./NotificationSettingsScreen";

// Language names are shown in their own language, whatever the interface language.
const languageChoices: { value: LanguagePreference; label: string; native?: true }[] = [
  { value: "auto", label: "Как в Telegram" },
  { value: "ru", label: "Русский", native: true },
  { value: "en", label: "English", native: true },
];

const themeChoices: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Как в Telegram" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: { value: T; label: string; native?: true }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="settings-choices" role="group">
      {choices.map((choice) => (
        <button
          aria-pressed={value === choice.value}
          className={`settings-choice${value === choice.value ? " selected" : ""}`}
          key={choice.value}
          lang={choice.native ? choice.value : undefined}
          onClick={() => onChange(choice.value)}
          type="button"
        >
          <span>{choice.native ? choice.label : t(choice.label)}</span>
          {value === choice.value && <Check aria-hidden="true" size={16} />}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen({
  navigate,
  onBack,
  languagePreference,
  onLanguage,
  themePreference,
  onTheme,
  section,
}: {
  navigate: Navigate;
  onBack: () => void;
  languagePreference: LanguagePreference;
  onLanguage: (value: LanguagePreference) => void;
  themePreference: ThemePreference;
  onTheme: (value: ThemePreference) => void;
  /** Opened from «Уведомления от бота» on Home: start at the notifications. */
  section?: "notifications";
}) {
  useEffect(() => {
    if (section === "notifications")
      document.getElementById("settings-notifications")?.scrollIntoView({ block: "start" });
  }, [section]);
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Настройки")} variant="nested" />
      <section className="settings-page">
        <section aria-labelledby="settings-language" className="settings-section">
          <h2 id="settings-language">{t("Язык")}</h2>
          <ChoiceGroup choices={languageChoices} label={t("Язык")} onChange={onLanguage} value={languagePreference} />
          {language() === "en" && <p className="settings-note">{t("Сообщения бота пока приходят на русском.")}</p>}
        </section>
        <section aria-labelledby="settings-theme" className="settings-section">
          <h2 id="settings-theme">{t("Тема")}</h2>
          <ChoiceGroup choices={themeChoices} label={t("Тема")} onChange={onTheme} value={themePreference} />
        </section>
        <NotificationSettingsPanel />
      </section>
    </main>
  );
}
