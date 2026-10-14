import { useCallback, useEffect, useState } from "react";
import { BarChart3, Bell, CalendarDays, Flag, Plus, Store } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import type { ResolvedTheme } from "../theme";
import type { AuthResult, MeetingListItem } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState, MeetingGroup } from "../ui/common";

export function Home({
  navigate,
  resolvedTheme,
  toggleTheme,
  user,
  isAdmin,
}: {
  navigate: Navigate;
  resolvedTheme: ResolvedTheme;
  toggleTheme: () => void;
  user: AuthResult["user"];
  isAdmin: boolean;
}) {
  const [data, setData] = useState<{
    owned: MeetingListItem[];
    participating: MeetingListItem[];
  } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api
      .meetings()
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить встречи.",
        ),
      );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const meetings = data
    ? [...data.owned, ...data.participating]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 4)
    : [];
  const meetingCount = data
    ? data.owned.length + data.participating.length
    : null;
  return (
    <main className="screen-with-bottom-navigation">
      <Header
        navigate={navigate}
        resolvedTheme={resolvedTheme}
        toggleTheme={toggleTheme}
        variant="home"
      />
      <section className="home-page">
        <h1 className="home-greeting">Привет, {user.firstName} 👋</h1>
        <div className="home-action-grid">
          <button
            className="home-create-card"
            onClick={() => navigate("/create")}
            type="button"
          >
            <span className="home-action-icon"><Plus size={28} /></span>
            <span className="home-create-copy">
              <strong>Создать встречу</strong>
              <small>Организуйте новое событие с друзьями</small>
            </span>
            <span className="home-create-cta">
              <Plus aria-hidden="true" size={18} />
              Начать
            </span>
          </button>
          <button
            className="home-meetings-shortcut"
            onClick={() => navigate("/my-events")}
            type="button"
          >
            <CalendarDays size={25} />
            <span>Мои встречи</span>
            <strong>{meetingCount ?? "—"}</strong>
          </button>
        </div>
        <button
          className="home-settings-link"
          onClick={() => navigate("/settings")}
          type="button"
        >
          <Bell size={18} />
          <span>Уведомления от бота</span>
        </button>
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/stats")}
            type="button"
          >
            <BarChart3 size={18} />
            <span>Статистика</span>
          </button>
        )}
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/reports")}
            type="button"
          >
            <Flag size={18} />
            <span>Жалобы</span>
          </button>
        )}
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/venues")}
            type="button"
          >
            <Store size={18} />
            <span>Каталог мест</span>
          </button>
        )}
        <div className="home-section-heading">
          <h2>Ваши встречи</h2>
          <button onClick={() => navigate("/my-events")} type="button">Все</button>
        </div>
        {!data && !error && <Loading label="Загружаем встречи…" />}
        {error && (
          <RetryState
            message={error}
            onRetry={() => void load()}
            title="Встречи не загрузились"
          />
        )}
        {data && (
          <MeetingGroup
            emptyText="Создайте встречу или откройте приглашение из Telegram."
            items={meetings}
            navigate={navigate}
          />
        )}
      </section>
      <BottomNavigation currentPath="/" navigate={navigate} />
    </main>
  );
}
