import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { barWidth, shareText, shortDay } from "../admin-stats";
import type { AdminStats } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState } from "../ui/common";

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
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить статистику."));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title="Статистика" variant="nested" />
      <section className="settings-page admin-stats">
        {!stats && !error && <Loading label="Считаем статистику…" />}
        {error && <RetryState message={error} onRetry={load} title="Статистика не загрузилась" />}
        {stats && (
          <>
            <section>
              <h2>Активные пользователи</h2>
              <div className="stat-grid stat-grid-3">
                <StatCard label="сегодня" value={stats.activeToday} />
                <StatCard label="за 7 дней" value={stats.active7d} />
                <StatCard label="за 30 дней" value={stats.active30d} />
              </div>
            </section>
            <section>
              <h2>За 7 дней</h2>
              <div className="stat-grid">
                <StatCard label="новых встреч" value={stats.meetings7d} />
                <StatCard label="ответов" value={stats.responses7d} />
                <StatCard label="заявок" value={stats.joinRequests7d} />
                <StatCard label="отправок в чат" value={stats.shares7d} />
                <StatCard label="переходов из уведомлений" value={stats.notificationOpens7d} />
                <StatCard label="новых пользователей" value={stats.usersNew7d} />
              </div>
            </section>
            <section className="stat-lines">
              <p><span>Вернулись за 7 дней</span><strong>{shareText(stats.returningUsers7d, stats.previousWeekUsers)}</strong></p>
              <p><span>Встречи с ответами, 30 дней</span><strong>{shareText(stats.meetingsWithResponses30d, stats.meetings30d)}</strong></p>
              <p><span>Всего пользователей</span><strong>{stats.usersTotal}</strong></p>
              <p><span>Всего встреч</span><strong>{stats.meetingsTotal}</strong></p>
            </section>
            <section>
              <h2>По дням</h2>
              <ul className="stat-days">
                {stats.daily.map((day) => (
                  <li key={day.day}>
                    <span className="stat-day-date">{shortDay(day.day)}</span>
                    <span className="stat-day-bar"><span style={{ width: `${barWidth(day.active, stats.daily)}%` }} /></span>
                    <span className="stat-day-values">{day.active} акт. · {day.meetings} встр. · {day.responses} отв.</span>
                  </li>
                ))}
              </ul>
              <p className="stat-note">
                Активные пользователи считаются по открытиям приложения с 13 октября 2026 года.
                Встречи и ответы — за всё время.
              </p>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
