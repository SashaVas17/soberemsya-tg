import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { onSessionExpired } from "./session";
import { initializeTelegram } from "./telegram";
import type { AuthResult, EventData } from "./types";
import { usePath, useTelegramBack, useAppTheme } from "./app-hooks";
import { Loading, RetryState } from "./ui/common";
import { AdminStatsScreen } from "./screens/AdminStatsScreen";
import { AdminReportsScreen } from "./screens/AdminReportsScreen";
import { BlockedUsersScreen, CommunityRulesScreen } from "./screens/SafetyScreens";
import { NotificationSettingsScreen } from "./screens/NotificationSettingsScreen";
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

export default function App() {
  const { path, navigate, goBack } = usePath();
  const { resolvedTheme, toggleTheme } = useAppTheme();
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
            : "Не удалось подтвердить данные Telegram.",
        ),
      );
  }, [navigate]);
  if (outside) return <OutsideTelegram />;
  if (sessionExpired) return <SessionExpired />;
  if (error)
    return (
      <main className="outside-screen">
        <RetryState
          message={error}
          onRetry={() => window.location.reload()}
          title="Не удалось открыть приложение"
        />
      </main>
    );
  if (!auth)
    return (
      <main className="outside-screen">
        <Loading label="Проверяем Telegram…" />
      </main>
    );
  const match = (pattern: RegExp) => path.match(pattern)?.[1];
  const created = match(/^\/created\/([^/]+)$/);
  if (created)
    return (
      <Created
        event={createdEvent?.id === created ? createdEvent : null}
        eventId={created}
        group={createdGroup?.eventId === created ? createdGroup : null}
        navigate={navigate}
        onBack={backOverride ?? goBack}
      />
    );
  const manage = match(/^\/manage\/([^/]+)$/);
  if (manage) return <Manage eventId={manage} navigate={navigate} onBack={backOverride ?? goBack} />;
  const result = match(/^\/result\/([^/]+)$/);
  if (result) return <Result eventId={result} navigate={navigate} onBack={backOverride ?? goBack} />;
  const event = match(/^\/event\/([^/]+)$/);
  if (event) return <ParticipantEvent eventId={event} navigate={navigate} onBack={backOverride ?? goBack} />;
  if (path === "/create")
    return (
      <CreateEvent
        navigate={navigate}
        onBack={backOverride ?? goBack}
        onCreated={handleCreated}
        groupToken={groupToken}
        setBackOverride={setBackOverride}
      />
    );
  if (path === "/open") return <PublicMeetings navigate={navigate} onBack={goBack} />;
  // "/map" was the placeholder tab before the venue catalogue.
  if (path === "/places" || path === "/map") return <PlacesScreen navigate={navigate} onBack={goBack} />;
  if (path === "/my-events") return <MyEvents navigate={navigate} onBack={goBack} />;
  if (path === "/settings") return <NotificationSettingsScreen navigate={navigate} onBack={goBack} />;
  if (path === "/admin/stats" && auth.isAdmin) return <AdminStatsScreen navigate={navigate} onBack={goBack} />;
  if (path === "/admin/venues" && auth.isAdmin) return <AdminVenuesScreen navigate={navigate} onBack={goBack} />;
  if (path === "/admin/reports" && auth.isAdmin) return <AdminReportsScreen navigate={navigate} onBack={goBack} />;
  if (path === "/blocked") return <BlockedUsersScreen navigate={navigate} onBack={goBack} />;
  if (path === "/rules") return <CommunityRulesScreen navigate={navigate} onBack={goBack} />;
  return (
    <Home
      navigate={navigate}
      resolvedTheme={resolvedTheme}
      toggleTheme={toggleTheme}
      user={auth.user}
      isAdmin={auth.isAdmin === true}
    />
  );
}
