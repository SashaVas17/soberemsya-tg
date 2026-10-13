import {
  CalendarDays,
  CircleAlert,
  Clock3,
  ArrowLeft,
  House,
  MapPin,
  Moon,
  RefreshCw,
  Sun,
  Users,
} from "lucide-react";
import { formatSlot, plural } from "../domain";
import { meetingCardData, meetingDestination } from "../navigation";
import type { ResolvedTheme } from "../theme";
import type { EventStatus, MeetingListItem } from "../types";
import type { Navigate } from "../app-types";

const statusLabels: Record<EventStatus, string> = {
  collecting: "Сбор ответов",
  place_selection: "Выбор места",
  decided: "Решение принято",
  cancelled: "Встреча отменена",
};

export function Header({
  navigate,
  onBack,
  resolvedTheme,
  toggleTheme,
  title = "Соберёмся",
  variant,
}: {
  navigate: Navigate;
  onBack?: () => void;
  resolvedTheme?: ResolvedTheme;
  toggleTheme?: () => void;
  title?: string;
  variant?: "home" | "root" | "nested";
}) {
  const isHome = variant === "home" || Boolean(resolvedTheme && toggleTheme);
  if (isHome) {
    return (
      <header className="topbar topbar-home">
        <button className="wordmark" onClick={() => navigate("/")} type="button">
          Соберёмся
        </button>
        {resolvedTheme && toggleTheme && (
          <button
            aria-label={
              resolvedTheme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
            className="theme-toggle"
            onClick={toggleTheme}
            title={resolvedTheme === "dark" ? "Светлая тема" : "Тёмная тема"}
            type="button"
          >
            {resolvedTheme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        )}
      </header>
    );
  }
  return (
    <header className={`topbar topbar-${variant ?? "nested"}`}>
      <button
        aria-label="Назад"
        className="topbar-action"
        onClick={onBack ?? (() => navigate("/"))}
        title="Назад"
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={20} />
      </button>
      <span className="topbar-title">{title}</span>
      <button
        aria-label="На главную"
        className="topbar-action"
        onClick={() => navigate("/")}
        title="На главную"
        type="button"
      >
        <House aria-hidden="true" size={20} />
      </button>
    </header>
  );
}

export function Loading({ label = "Загружаем…" }: { label?: string }) {
  return (
    <div aria-live="polite" className="loading state-surface">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <p className="form-error">{message}</p> : null;
}

export function RetryState({
  title = "Что-то пошло не так",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="state-card error-state" role="alert">
      <span className="state-icon error-state-icon"><CircleAlert size={30} /></span>
      <div className="state-copy">
        <strong>{title}</strong>
        <p>{message}</p>
        {onRetry && (
          <button className="secondary-action" onClick={onRetry} type="button">
            <RefreshCw size={17} />
            Попробовать снова
          </button>
        )}
      </div>
    </section>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="state-card empty-state">
      <span className="state-icon empty-state-icon"><CalendarDays size={32} /></span>
      <div className="state-copy">
        <strong>{title}</strong>
        <p>{text}</p>
        {action}
      </div>
    </section>
  );
}

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`status-badge ${status}`}>{statusLabels[status]}</span>
  );
}

export function MeetingGroup({
  items,
  navigate,
  title,
  emptyText = "Здесь пока ничего нет.",
  showAction = false,
}: {
  items: MeetingListItem[];
  navigate: Navigate;
  title?: string;
  emptyText?: string;
  showAction?: boolean;
}) {
  return (
    <div className="meeting-group">
      {title && <h2>{title}</h2>}
      {items.length ? (
        items.map((item) => {
          const card = meetingCardData(item);
          return (
            <button
              className="meeting-card"
              key={item.id}
              onClick={() => navigate(meetingDestination(item))}
              type="button"
            >
              <div className="meeting-card-heading">
                <strong className="meeting-card-title">{card.title}</strong>
                <StatusBadge status={card.status} />
              </div>
              <div className="meeting-card-meta">
                {(card.timeSummary || item.bestTime) && (
                  <span>
                    <Clock3 size={15} />
                    {card.timeSummary ?? formatSlot(item.bestTime!.startsAt)}
                  </span>
                )}
                {card.placeSummary && (
                  <span>
                    <MapPin size={15} />
                    {card.placeSummary}
                  </span>
                )}
                <span>
                  <Users size={15} />
                  {plural(card.responseCount, "ответил", "ответили", "ответили")}
                </span>
              </div>
              {showAction && (
                <span className="meeting-card-action">
                  {item.role === "owner" ? "Управлять" : "Открыть"}
                </span>
              )}
            </button>
          );
        })
      ) : (
        <EmptyState title="Пока пусто" text={emptyText} />
      )}
    </div>
  );
}

export function Refresh({
  refreshing,
  lastUpdated,
  onClick,
}: {
  refreshing: boolean;
  lastUpdated: Date | null;
  onClick: () => void;
}) {
  return (
    <div className="refresh">
      <button
        className="secondary-action"
        disabled={refreshing}
        onClick={onClick}
        type="button"
      >
        <RefreshCw className={refreshing ? "spin" : ""} size={18} />
        {refreshing ? "Обновление…" : "Обновить данные"}
      </button>
      <span>
        {lastUpdated
          ? `Последнее обновление: ${lastUpdated.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
      </span>
    </div>
  );
}
