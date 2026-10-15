import { Fragment, useCallback, useEffect, useState, type ReactElement } from "react";
import { api } from "./api";
import { onSessionExpired } from "./session";
import { initializeTelegram } from "./telegram";
import type { AuthResult, EventData } from "./types";
import { usePath, useTelegramBack, useAppTheme } from "./app-hooks";
import { Loading, RetryState } from "./ui/common";
import { AdminStatsScreen } from "./screens/AdminStatsScreen";
import { AdminReportsScreen } from "./screens/AdminReportsScreen";
import { BlockedUsersScreen, CommunityRulesScreen } from "./screens/SafetyScreens";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SessionExpired, OutsideTelegram } from "./screens/SystemScreens";
import { Home } from "./screens/Home";
import { PublicMeetings } from "./screens/PublicMeetings";
import { PlacesScreen } from "./screens/PlacesScreen";
import { AdminVenuesScreen } from "./screens/AdminVenuesScreen";
import { CreateEvent } from "./screens/CreateEvent";
import type { CreatedGroup } from "./app-types";
import { Created } from "./screens/Created";
import { ParticipantEvent } from "./screens/ParticipantEvent";
import { MyEvents } from "./screens/MyEvents";
import { Manage } from "./screens/Manage";
import { Result } from "./screens/Result";
import { language, languageSync, readLanguageSynced, refreshLanguage, saveLanguagePreference, readLanguagePreference, t, writeLanguageSynced, type LanguagePreference } from "./i18n";
import { saveLanguageOnServer } from "./language-preference";

export default function App() {
  const { path, navigate, goBack } = usePath();
  const { themePreference, setThemePreference } = useAppTheme();
  // Texts are read at render time (t() in src/i18n.ts).
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(readLanguagePreference);
  const [currentLanguage, setCurrentLanguage] = useState(language);
  const applyLanguagePreference = useCallback((next: LanguagePreference) => {
    saveLanguagePreference(next);
    setLanguagePreferenceState(next);
    setCurrentLanguage(language());
  }, []);
  // The server keeps the choice for the bot and notifications.
  const setLanguagePreference = useCallback((next: LanguagePreference) => {
    applyLanguagePreference(next);
    void saveLanguageOnServer(next);
  }, [applyLanguagePreference]);
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [createdEvent, setCreatedEvent] = useState<EventData | null>(null);
  const [createdGroup, setCreatedGroup] = useState<(CreatedGroup & { eventId: string }) | null>(null);
  const [groupToken, setGroupToken] = useState<string | null>(null);
  const handleCreated = useCallback((event: EventData, group?: CreatedGroup) => {
    setCreatedEvent(event);
    setCreatedGroup(group ? { ...group, eventId: event.id } : null);
    if (group) setGroupToken(null);
  }, []);
  // A group link applies only to the create screen it opened.
  useEffect(() => {
    if (path !== "/create") setGroupToken(null);
  }, [path]);
  const [sessionExpired, setSessionExpired] = useState(false);
  useTelegramBack(path, goBack, backOverride);
  useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);
  useEffect(() => {
    const app = initializeTelegram();
    setCurrentLanguage(refreshLanguage());
    const mock = import.meta.env.VITE_USE_MOCK_TELEGRAM === "true";
    const raw =
      app?.initData ||
      (mock ? import.meta.env.VITE_MOCK_INIT_DATA || "mock" : "");
    if (!raw) {
      setOutside(true);
      return;
    }
    api
      .auth(raw)
      .then((result) => {
        const sync = languageSync(readLanguagePreference(), readLanguageSynced(), result.language);
        if (sync && "adopt" in sync) {
          applyLanguagePreference(sync.adopt);
          writeLanguageSynced(true);
        } else if (sync) void saveLanguageOnServer(sync.send ?? "auto");
        else if (result.language !== undefined) writeLanguageSynced(true);
        setAuth(result);
        if (result.startParam?.startsWith("event_"))
          navigate(`/event/${result.startParam.slice(6)}`, true);
        // A report notification for the administrator.
        else if (result.startParam === "reports" && result.isAdmin)
          navigate("/admin/reports", true);
        else if (result.startParam?.startsWith("ntf_"))
          navigate(`/event/${result.startParam.slice(4)}`, true);
        else if (result.startParam?.startsWith("group_")) {
          setGroupToken(result.startParam.slice(6));
          navigate("/create", true);
        } else {
          const requestedScreen = new URLSearchParams(
            window.location.search,
          ).get("screen");
          if (requestedScreen === "create") navigate("/create", true);
          if (requestedScreen === "my-events") navigate("/my-events", true);
        }
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : t("Не удалось подтвердить данные Telegram."),
        ),
      );
  }, [navigate, applyLanguagePreference]);
  if (outside) return <OutsideTelegram />;
  if (sessionExpired) return <SessionExpired />;
  if (error)
    return (
      <main className="outside-screen">
        <RetryState
          message={error}
          onRetry={() => window.location.reload()}
          title={t("Не удалось открыть приложение")}
        />
      </main>
    );
  if (!auth)
    return (
      <main className="outside-screen">
        <Loading label={t("Проверяем Telegram…")} />
      </main>
    );
  // A new language re-creates the screen, so texts kept in its state
  // (errors, loaded messages) are shown again in that language.
  const keyed = (screen: ReactElement) => <Fragment key={currentLanguage}>{screen}</Fragment>;
  const match = (pattern: RegExp) => path.match(pattern)?.[1];
  const created = match(/^\/created\/([^/]+)$/);
  if (created)
    return keyed(
      <Created
        event={createdEvent?.id === created ? createdEvent : null}
        eventId={created}
        group={createdGroup?.eventId === created ? createdGroup : null}
        navigate={navigate}
        onBack={backOverride ?? goBack}
      />
    );
  const manage = match(/^\/manage\/([^/]+)$/);
  if (manage) return keyed(<Manage eventId={manage} navigate={navigate} onBack={backOverride ?? goBack} />);
  const result = match(/^\/result\/([^/]+)$/);
  if (result) return keyed(<Result eventId={result} navigate={navigate} onBack={backOverride ?? goBack} />);
  const event = match(/^\/event\/([^/]+)$/);
  if (event) return keyed(<ParticipantEvent eventId={event} navigate={navigate} onBack={backOverride ?? goBack} />);
  if (path === "/create")
    return keyed(
      <CreateEvent
        navigate={navigate}
        onBack={backOverride ?? goBack}
        onCreated={handleCreated}
        groupToken={groupToken}
        setBackOverride={setBackOverride}
      />
    );
  if (path === "/open") return keyed(<PublicMeetings navigate={navigate} onBack={goBack} />);
  // "/map" was the placeholder tab before the venue catalogue.
  if (path === "/places" || path === "/map") return keyed(<PlacesScreen navigate={navigate} onBack={goBack} />);
  if (path === "/my-events") return keyed(<MyEvents navigate={navigate} onBack={goBack} />);
  if (path === "/settings" || path === "/settings/notifications")
    return keyed(
      <SettingsScreen
        languagePreference={languagePreference}
        section={path === "/settings/notifications" ? "notifications" : undefined}
        navigate={navigate}
        onBack={goBack}
        onLanguage={setLanguagePreference}
        onTheme={setThemePreference}
        themePreference={themePreference}
      />
    );
  if (path === "/admin/stats" && auth.isAdmin) return keyed(<AdminStatsScreen navigate={navigate} onBack={goBack} />);
  if (path === "/admin/venues" && auth.isAdmin) return keyed(<AdminVenuesScreen navigate={navigate} onBack={goBack} />);
  if (path === "/admin/reports" && auth.isAdmin) return keyed(<AdminReportsScreen navigate={navigate} onBack={goBack} />);
  if (path === "/blocked") return keyed(<BlockedUsersScreen navigate={navigate} onBack={goBack} />);
  if (path === "/rules") return keyed(<CommunityRulesScreen navigate={navigate} onBack={goBack} />);
  return keyed(
    <Home
      navigate={navigate}
      user={auth.user}
      isAdmin={auth.isAdmin === true}
    />
  );
}
