import {
  CalendarDays,
  CircleAlert,
  ArrowLeft,
  House,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import { categoryIcon } from "../categories";
import { formatSlot, plural } from "../domain";
import { meetingCardData, meetingDestination } from "../navigation";
import { meetingTime } from "../my-meetings";
import { ticketDate } from "../ticket";
import type { EventStatus, MeetingCategory, MeetingListItem } from "../types";
import type { Navigate } from "../app-types";
import { locale, t } from "../i18n";

const statusLabels: Record<EventStatus, string> = {
  collecting: "Сбор ответов",
  place_selection: "Выбор места",
  decided: "Решение принято",
  cancelled: "Встреча отменена",
};

export function Header({
  navigate,
  onBack,
  title = "Flockly",
  variant,
  heading = false,
}: {
  navigate: Navigate;
  onBack?: () => void;
  title?: string;
  variant?: "home" | "root" | "nested";
  /** The bar's title is the screen's only heading (Settings): render it as h1. */
  heading?: boolean;
}) {
  if (variant === "home") {
    // Language, theme and notifications live behind the gear (stage 4).
    return (
      <header className="topbar topbar-home">
        <button className="wordmark" onClick={() => navigate("/")} type="button">
          Flockly
        </button>
        <button
          aria-label={t("Настройки")}
          className="topbar-settings"
          onClick={() => navigate("/settings")}
          title={t("Настройки")}
          type="button"
        >
          <Settings aria-hidden="true" size={20} />
        </button>
      </header>
    );
  }
  return (
    <header className={`topbar topbar-${variant ?? "nested"}`}>
      <button
        aria-label={t("Назад")}
        className="topbar-action"
        onClick={onBack ?? (() => navigate("/"))}
        title={t("Назад")}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={20} />
      </button>
      {heading ? <h1 className="topbar-title">{title}</h1> : <span className="topbar-title">{title}</span>}
      <button
        aria-label={t("На главную")}
        className="topbar-action"
        onClick={() => navigate("/")}
        title={t("На главную")}
        type="button"
      >
        <House aria-hidden="true" size={20} />
      </button>
    </header>
  );
}

export function Loading({ label = t("Загружаем…") }: { label?: string }) {
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
  title = t("Что-то пошло не так"),
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
            {t("Попробовать снова")}</button>
        )}
      </div>
    </section>
  );
}

export function EmptyState({
  title,
  text,
  action,
  icon,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="state-card empty-state">
      <span className="state-icon empty-state-icon">{icon ?? <CalendarDays size={32} />}</span>
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
    <span className={`status-badge ${status}`}>{t(statusLabels[status])}</span>
  );
}

export function MeetingGroup({
  items,
  navigate,
  title,
  emptyText = t("Здесь пока ничего нет."),
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
          const time = meetingTime(item);
          const date = time ? ticketDate(time.startsAt) : null;
          // Only a decided meeting has a date; before that the leading option is shown muted.
          const decided = card.status === "decided";
          const soon = decided ? date?.soon ?? null : null;
          const when = [decided ? date?.time : card.timeSummary, card.placeSummary]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              className="meeting-card meeting-ticket"
              key={item.id}
              onClick={() => navigate(meetingDestination(item))}
              type="button"
            >
              {date ? (
                <span aria-hidden="true" className={`ticket-date${decided ? "" : " ticket-date-tentative"}`}>
                  <span className="ticket-month">{date.month}</span>
                  <span className="ticket-day">{date.day}</span>
                  <span className="ticket-weekday">{date.weekday}</span>
                </span>
              ) : (
                <span aria-hidden="true" className="ticket-date ticket-date-empty">
                  <CalendarDays size={22} />
                </span>
              )}
              <span className="ticket-body">
                <strong className="meeting-card-title">{card.title}</strong>
                {time && (
                  <span className="sr-only">
                    {decided ? formatSlot(time.startsAt) : t("Пока лидирует: {time}", { time: formatSlot(time.startsAt) })}
                  </span>
                )}
                {(soon || when) && (
                  <span className="ticket-when">
                    {soon && <b>{soon}</b>}
                    {soon && when && " · "}
                    {when}
                  </span>
                )}
                <span className="ticket-foot">
                  <span className="ticket-count">
                    <Users aria-hidden="true" size={15} />
                    {plural(card.responseCount, "ответил", "ответили", "ответили")}
                  </span>
                  <StatusBadge status={card.status} />
                </span>
                {showAction && (
                  <span className="meeting-card-action">
                    {item.role === "owner" ? t("Управлять") : t("Открыть")}
                  </span>
                )}
              </span>
            </button>
          );
        })
      ) : (
        <EmptyState title={t("Пока пусто")} text={emptyText} />
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
        {refreshing ? t("Обновление…") : t("Обновить данные")}
      </button>
      <span>
        {lastUpdated
          ? t("Последнее обновление: {time}", { time: lastUpdated.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
          : ""}
      </span>
    </div>
  );
}

export function CategoryBadge({ category }: { category: MeetingCategory }) {
  const Icon = categoryIcon(category.id);
  return (
    <span className="category-badge">
      <Icon aria-hidden="true" size={14} />
      {t(category.name)}
    </span>
  );
}

/** A category toggle used in the open meetings filter and in the create wizard. */
export function CategoryChip({
  category,
  selected,
  onToggle,
  disabled = false,
}: {
  category: MeetingCategory;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const Icon = categoryIcon(category.id);
  return (
    <button
      aria-pressed={selected}
      className={`category-chip${selected ? " selected" : ""}`}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
      {t(category.name)}
    </button>
  );
}
