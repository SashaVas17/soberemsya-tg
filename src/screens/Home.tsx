import { useCallback, useEffect, useState } from "react";
import { BarChart3, Bell, CalendarDays, Flag, Plus, Store } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import type { AuthResult, MeetingListItem } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState, MeetingGroup } from "../ui/common";
import { t } from "../i18n";
import { nearestMeeting } from "../my-meetings";

export function Home({
  navigate,
  user,
  isAdmin,
}: {
  navigate: Navigate;
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
            : t("Не удалось загрузить встречи."),
        ),
      );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const nearest = data ? nearestMeeting([...data.owned, ...data.participating]) : null;
  const meetingCount = data
    ? data.owned.length + data.participating.length
    : null;
  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} variant="home" />
      <section className="home-page">
        <h1 className="home-greeting">{t("Привет,")} {user.firstName} 👋</h1>
        <div className="home-action-grid">
          <button
            className="home-create-card"
            onClick={() => navigate("/create")}
            type="button"
          >
            <span className="home-action-icon"><Plus size={28} /></span>
            <span className="home-create-copy">
              <strong>{t("Создать встречу")}</strong>
              <small>{t("Организуйте новое событие с друзьями")}</small>
            </span>
            <span className="home-create-cta">
              <Plus aria-hidden="true" size={18} />
              {t("Начать")}</span>
          </button>
          <button
            className="home-meetings-shortcut"
            onClick={() => navigate("/my-events")}
            type="button"
          >
            <CalendarDays size={25} />
            <span>{t("Мои встречи")}</span>
            <strong>{meetingCount ?? "—"}</strong>
          </button>
        </div>
        <button
          className="home-settings-link"
          onClick={() => navigate("/settings/notifications")}
          type="button"
        >
          <Bell size={18} />
          <span>{t("Уведомления от бота")}</span>
        </button>
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/stats")}
            type="button"
          >
            <BarChart3 size={18} />
            <span>{t("Статистика")}</span>
          </button>
        )}
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/reports")}
            type="button"
          >
            <Flag size={18} />
            <span>{t("Жалобы")}</span>
          </button>
        )}
        {isAdmin && (
          <button
            className="home-settings-link"
            onClick={() => navigate("/admin/venues")}
            type="button"
          >
            <Store size={18} />
            <span>{t("Каталог мест")}</span>
          </button>
        )}
        <div className="home-section-heading">
          <h2>{t("Ближайшая встреча")}</h2>
          <button onClick={() => navigate("/my-events")} type="button">{t("Все")}</button>
        </div>
        {!data && !error && <Loading label={t("Загружаем встречи…")} />}
        {error && (
          <RetryState
            message={error}
            onRetry={() => void load()}
            title={t("Встречи не загрузились")}
          />
        )}
        {data && (
          <MeetingGroup
            emptyText={t("Создайте встречу или откройте приглашение из Telegram.")}
            items={nearest ? [nearest] : []}
            navigate={navigate}
          />
        )}
      </section>
      <BottomNavigation currentPath="/" navigate={navigate} />
    </main>
  );
}
