import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { barWidth, shareText, shortDay } from "../admin-stats";
import type { AdminStats } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState } from "../ui/common";
import { t } from "../i18n";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// Visible only to administrators: the API answers 404 to everyone else.
export function AdminStatsScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    api.adminStats().then(({ stats: loaded }) => setStats(loaded)).catch((reason) =>
      setError(reason instanceof Error ? reason.message : t("Не удалось загрузить статистику.")));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Статистика")} variant="nested" />
      <section className="settings-page admin-stats">
        {!stats && !error && <Loading label={t("Считаем статистику…")} />}
        {error && <RetryState message={error} onRetry={load} title={t("Статистика не загрузилась")} />}
        {stats && (
          <>
            <section>
              <h2>{t("Активные пользователи")}</h2>
              <div className="stat-grid stat-grid-3">
                <StatCard label={t("сегодня")} value={stats.activeToday} />
                <StatCard label={t("за 7 дней")} value={stats.active7d} />
                <StatCard label={t("за 30 дней")} value={stats.active30d} />
              </div>
            </section>
            <section>
              <h2>{t("За 7 дней")}</h2>
              <div className="stat-grid">
                <StatCard label={t("новых встреч")} value={stats.meetings7d} />
                <StatCard label={t("ответов")} value={stats.responses7d} />
                <StatCard label={t("заявок")} value={stats.joinRequests7d} />
                <StatCard label={t("отправок в чат")} value={stats.shares7d} />
                <StatCard label={t("переходов из уведомлений")} value={stats.notificationOpens7d} />
                <StatCard label={t("новых пользователей")} value={stats.usersNew7d} />
              </div>
            </section>
            <section className="stat-lines">
              <p><span>{t("Вернулись за 7 дней")}</span><strong>{shareText(stats.returningUsers7d, stats.previousWeekUsers)}</strong></p>
              <p><span>{t("Встречи с ответами, 30 дней")}</span><strong>{shareText(stats.meetingsWithResponses30d, stats.meetings30d)}</strong></p>
              <p><span>{t("Всего пользователей")}</span><strong>{stats.usersTotal}</strong></p>
              <p><span>{t("Всего встреч")}</span><strong>{stats.meetingsTotal}</strong></p>
            </section>
            <section>
              <h2>{t("По дням")}</h2>
              <ul className="stat-days">
                {stats.daily.map((day) => (
                  <li key={day.day}>
                    <span className="stat-day-date">{shortDay(day.day)}</span>
                    <span className="stat-day-bar"><span style={{ width: `${barWidth(day.active, stats.daily)}%` }} /></span>
                    <span className="stat-day-values">{day.active}  {t("акт. ·")} {day.meetings}  {t("встр. ·")} {day.responses}  {t("отв.")}</span>
                  </li>
                ))}
              </ul>
              <p className="stat-note">
                {t("Активные пользователи считаются по открытиям приложения с 13 октября 2026 года. Встречи и ответы — за всё время.")}</p>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
