import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ArrowLeft,
  House,
  MapPin,
  Moon,
  Plus,
  RefreshCw,
  Send,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "./api";
import { mergeMeetingItems } from "./my-meetings";
import { hasApiErrorCode } from "./api-error";
import { BottomNavigation } from "./BottomNavigation";
import { googleCalendarUrl } from "./calendar";
import {
  advanceCreateStep,
  addTimeOption,
  createdEventPath,
  createTimeOption,
  previousCreateStep,
  removeTimeOption,
  submitCreateEventOnce,
  validateCreateStep,
  type CreateWizardDraft,
  type MeetingVisibility,
  type PlaceDraft,
} from "./create-wizard";
import { areaLeaders, bestSlot, formatSlot, plural } from "./domain";
import { mergePublicMeetings } from "./public-feed";
import { canLeaveMeeting, leaveMeetingOnce } from "./leave-meeting";
import {
  eventShareUrl as buildEventShareUrl,
  managementPath,
  miniAppLink as buildMiniAppLink,
  resultShareUrl as buildResultShareUrl,
} from "./meeting-links";
import { managePayloads, runActionOnce } from "./manage-actions";
import { meetingCardData, meetingDestination } from "./navigation";
import {
  nonNegativeIntegerFromInput,
  normalizeNumericInput,
  requiredNonNegativeIntegerFromInput,
} from "./numeric-input";
import { OrganizerJoinRequests } from "./OrganizerJoinRequests";
import {
  createJoinRequestOnce,
  publicJoinRequestView,
} from "./join-request";
import {
  saveResponseOnce,
  toggleOption,
  toggleTimeOption,
  votingDraftFromEvent,
  type VotingDraft,
} from "./participant-voting";
import { resultPlace, resultTime } from "./result-model";
import {
  haptic,
  initializeTelegram,
  openExternalUrl,
  openTelegramUrl,
  telegram,
} from "./telegram";
import {
  applyTheme,
  initialResolvedTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToTelegramTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";
import type {
  AuthResult,
  EventData,
  EventStatus,
  MeetingListItem,
  OrganizerParticipant,
  PublicEventPreview,
  PublicMeetingFeedItem,
} from "./types";

type Navigate = (path: string, replace?: boolean) => void;
type EditablePlaceDraft = Omit<PlaceDraft, "estimatedBudget"> & {
  estimatedBudget: string;
};

const statusLabels: Record<EventStatus, string> = {
  collecting: "Сбор ответов",
  place_selection: "Выбор места",
  decided: "Решение принято",
  cancelled: "Встреча отменена",
};

function usePath() {
  const readPath = () => {
    const value = window.location.hash.slice(1);
    return value.startsWith("/") ? value : "/";
  };
  const initialPath = useRef(readPath());
  const historyStack = useRef([initialPath.current]);
  const currentPath = useRef(initialPath.current);
  const [path, setPath] = useState(initialPath.current);
  useEffect(() => {
    const onHashChange = () => {
      const next = readPath();
      if (next === currentPath.current) return;
      const previousIndex = historyStack.current.lastIndexOf(next);
      if (previousIndex >= 0) historyStack.current.splice(previousIndex + 1);
      else historyStack.current.push(next);
      currentPath.current = next;
      setPath(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = useCallback<Navigate>((next, replace = false) => {
    if (next === currentPath.current && !replace) return;
    if (replace) historyStack.current[historyStack.current.length - 1] = next;
    else historyStack.current.push(next);
    currentPath.current = next;
    const target = `#${next}`;
    if (replace)
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${target}`);
    else window.location.hash = next;
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const goBack = useCallback(() => {
    if (historyStack.current.length <= 1) {
      navigate("/", true);
      return;
    }
    historyStack.current.pop();
    navigate(historyStack.current[historyStack.current.length - 1], true);
  }, [navigate]);
  return { path, navigate, goBack };
}

function useTelegramBack(
  path: string,
  goBack: () => void,
  override: (() => void) | null,
) {
  useEffect(() => {
    const button = telegram()?.BackButton;
    if (!button) return;
    const back = () => {
      if (override) {
        override();
        return;
      }
      goBack();
    };
    if (path === "/") button.hide();
    else {
      button.show();
      button.onClick(back);
    }
    return () => button.offClick(back);
  }, [goBack, override, path]);
}

function useMainButton(
  label: string,
  enabled: boolean,
  action: () => void,
  visible = true,
) {
  useEffect(() => {
    const button = telegram()?.MainButton;
    if (!button || !visible) return;
    button.setText(label);
    if (enabled) button.enable();
    else button.disable();
    button.show();
    button.onClick(action);
    return () => {
      button.offClick(action);
      button.hide();
    };
  }, [action, enabled, label, visible]);
}

function useAppTheme() {
  const preference = useRef<ThemePreference>(readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    initialResolvedTheme(telegram()),
  );
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);
  useEffect(
    () =>
      subscribeToTelegramTheme(
        telegram(),
        () => preference.current,
        setResolvedTheme,
      ),
    [],
  );
  const toggleTheme = useCallback(() => {
    const current = resolveTheme(
      preference.current,
      telegram()?.colorScheme ?? null,
    );
    const next: ThemePreference = current === "dark" ? "light" : "dark";
    preference.current = next;
    saveThemePreference(next);
    setResolvedTheme(next);
  }, []);
  return { resolvedTheme, toggleTheme };
}

function Header({
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

function Loading({ label = "Загружаем…" }: { label?: string }) {
  return (
    <div aria-live="polite" className="loading state-surface">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return message ? <p className="form-error">{message}</p> : null;
}

function RetryState({
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

function EmptyState({
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

function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`status-badge ${status}`}>{statusLabels[status]}</span>
  );
}

function OutsideTelegram() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "";
  return (
    <main className="outside-screen">
      <section className="home-preview">
        <span>Telegram Mini App</span>
        <h1>Соберёмся</h1>
        <p>
          Откройте приложение через Telegram, чтобы создавать встречи и
          голосовать вместе.
        </p>
        <button
          className="secondary-action"
          disabled={!bot}
          onClick={() => openTelegramUrl(`https://t.me/${bot}`)}
          type="button"
        >
          Открыть в Telegram
        </button>
      </section>
    </main>
  );
}

function Home({
  navigate,
  resolvedTheme,
  toggleTheme,
  user,
}: {
  navigate: Navigate;
  resolvedTheme: ResolvedTheme;
  toggleTheme: () => void;
  user: AuthResult["user"];
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

function PublicMeetings({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [items, setItems] = useState<PublicMeetingFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    const isLoadingMore = Boolean(cursor);
    if (isLoadingMore) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const result = await api.publicMeetings(cursor);
      if (isLoadingMore) {
        setItems((current) => mergePublicMeetings(current, result.items));
      } else {
        setItems(mergePublicMeetings([], result.items));
      }
      setNextCursor(result.nextCursor);
    } catch (reason) {
      console.error("public_meetings_load_failed", reason);
      setError("Не удалось загрузить открытые встречи.");
    } finally {
      if (isLoadingMore) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = items.length > 0 && (
    <div className="meeting-group public-meeting-list">
      {items.map((item) => (
        <button
          className="meeting-card public-meeting-card"
          key={item.id}
          onClick={() => navigate(`/event/${item.id}`)}
          type="button"
        >
          <div className="public-meeting-card-heading">
            <strong className="meeting-card-title">{item.title}</strong>
            {item.description && (
              <p className="public-meeting-description">{item.description}</p>
            )}
          </div>
          <div className="meeting-card-meta">
            {item.dateSummary && (
              <span>
                <Clock3 size={15} />
                {item.dateSummary}
              </span>
            )}
            <span>
              <Users size={15} />
              {item.maxParticipants === null
                ? plural(item.participantCount, "участник", "участника", "участников")
                : `${item.participantCount} из ${item.maxParticipants} участников`}
            </span>
            <span>
              {item.budgetLimit > 0
                ? `До ${item.budgetLimit} BYN`
                : "Бюджет не указан"}
            </span>
          </div>
          <span className="meeting-card-action">Подробнее</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Соберёмся" variant="root" />
      <section className="public-meetings-page">
        <div className="page-intro public-meetings-intro">
          <h1>Открытые встречи</h1>
          <p>Найдите встречу и отправьте заявку на участие.</p>
        </div>
        {loading && !items.length && (
          <Loading label="Загружаем открытые встречи…" />
        )}
        {!loading && !items.length && !error && (
          <EmptyState
            title="Пока нет открытых встреч"
            text="Открытые встречи появятся здесь, когда организаторы начнут их собирать."
          />
        )}
        {error && !items.length && (
          <RetryState
            message={error}
            onRetry={() => void load()}
            title="Не удалось загрузить открытые встречи."
          />
        )}
        {cards}
        {error && items.length > 0 && (
          <div className="public-feed-pagination-error" role="alert">
            <span>{error}</span>
            <button
              className="secondary-action compact-action"
              onClick={() => void load(nextCursor ?? undefined)}
              type="button"
            >
              Повторить
            </button>
          </div>
        )}
        {nextCursor && !error && (
          <button
            className="secondary-action public-feed-load-more"
            disabled={loadingMore}
            onClick={() => void load(nextCursor)}
            type="button"
          >
            {loadingMore ? "Загружаем…" : "Загрузить ещё"}
          </button>
        )}
      </section>
      <BottomNavigation currentPath="/open" navigate={navigate} />
    </main>
  );
}

function MeetingGroup({
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

function SlotBuilder({
  slots,
  onChange,
}: {
  slots: string[];
  onChange: (next: string[]) => void;
}) {
  const today = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const defaultTime = "18:30";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState(defaultDate);
  const [pickerTime, setPickerTime] = useState(defaultTime);
  const [pickerError, setPickerError] = useState("");
  const slotValues = (slot: string) => {
    const value = new Date(slot);
    return {
      date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
    };
  };
  const change = (slot: string, nextDate: string, nextTime: string) => {
    const value = new Date(`${nextDate}T${nextTime}:00`).toISOString();
    onChange(addTimeOption(removeTimeOption(slots, slot), value));
  };
  const openPicker = () => {
    setPickerDate(defaultDate);
    setPickerTime(defaultTime);
    setPickerError("");
    setPickerOpen(true);
  };
  const confirmPicker = () => {
    const option = createTimeOption(pickerDate, pickerTime);
    if (!option) {
      setPickerError("Выберите корректные дату и время.");
      return;
    }
    if (slots.includes(option)) {
      setPickerError("Этот вариант уже добавлен.");
      return;
    }
    onChange(addTimeOption(slots, option));
    setPickerOpen(false);
    setPickerError("");
  };
  return (
    <div className="slot-builder">
      <div className="slot-list" aria-live="polite">
        {slots.map((slot) => {
          const values = slotValues(slot);
          return (
            <section className="slot-option-card" key={slot}>
              <label className="field">
                <span>Дата</span>
                <input
                  min={defaultDate}
                  onChange={(event) => change(slot, event.target.value, values.time)}
                  type="date"
                  value={values.date}
                />
              </label>
              <label className="field">
                <span>Время</span>
                <input
                  onChange={(event) => change(slot, values.date, event.target.value)}
                  type="time"
                  value={values.time}
                />
              </label>
              {slots.length > 1 && (
                <button
                  aria-label="Удалить вариант"
                  className="icon-action danger"
                  onClick={() => onChange(removeTimeOption(slots, slot))}
                  title="Удалить вариант"
                  type="button"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </section>
          );
        })}
      </div>
      <button
        className="secondary-action slot-add-action"
        onClick={openPicker}
        type="button"
      >
        <Plus size={18} />
        Добавить время
      </button>
      {pickerOpen && (
        <div className="time-picker-backdrop" role="presentation">
          <section
            aria-labelledby="time-picker-title"
            aria-modal="true"
            className="time-picker-dialog"
            role="dialog"
          >
            <div className="section-row">
              <h2 id="time-picker-title">Новый вариант времени</h2>
              <button
                aria-label="Закрыть выбор времени"
                className="icon-action"
                onClick={() => setPickerOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="field">
              <span>Дата</span>
              <input
                min={defaultDate}
                onChange={(event) => setPickerDate(event.target.value)}
                type="date"
                value={pickerDate}
              />
            </label>
            <label className="field">
              <span>Время</span>
              <input
                onChange={(event) => setPickerTime(event.target.value)}
                type="time"
                value={pickerTime}
              />
            </label>
            {pickerError && <p className="form-error">{pickerError}</p>}
            <div className="time-picker-actions">
              <button
                className="secondary-action"
                onClick={() => setPickerOpen(false)}
                type="button"
              >
                Отмена
              </button>
              <button
                className="primary-action"
                onClick={confirmPicker}
                type="button"
              >
                Добавить
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CreateEvent({
  navigate,
  onBack,
  setBackOverride,
  onCreated,
}: {
  navigate: Navigate;
  onBack: () => void;
  setBackOverride: (value: (() => void) | null) => void;
  onCreated: (event: EventData) => void;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetLimitInput, setBudgetLimitInput] = useState("30");
  const [visibility, setVisibility] = useState<MeetingVisibility>("private");
  const [hasParticipantLimit, setHasParticipantLimit] = useState(false);
  const [maxParticipantsInput, setMaxParticipantsInput] = useState("6");
  const [timeOptions, setTimeOptions] = useState<string[]>([]);
  const [places, setPlaces] = useState<EditablePlaceDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const budgetLimit = nonNegativeIntegerFromInput(budgetLimitInput);
  const hasValidTimeOption = timeOptions.some(
    (option) => !Number.isNaN(Date.parse(option)),
  );
  const maxParticipants = hasParticipantLimit
    ? requiredNonNegativeIntegerFromInput(maxParticipantsInput)
    : null;
  const draft: CreateWizardDraft = {
    title,
    description,
    budgetLimit,
    visibility,
    maxParticipants,
    timeOptions,
    places: places.map((place) => ({
      ...place,
      estimatedBudget: nonNegativeIntegerFromInput(place.estimatedBudget),
    })),
  };
  useEffect(() => {
    setBackOverride(() => () => {
      if (step > 1) setStep((current) => previousCreateStep(current));
      else navigate("/");
    });
    return () => setBackOverride(null);
  }, [navigate, setBackOverride, step]);

  const next = () => {
    const transition = advanceCreateStep(step, draft);
    if (transition.error) {
      setError(transition.error);
      return;
    }
    setError("");
    setStep(transition.step);
  };
  const submit = useCallback(async () => {
    if (
      validateCreateStep(1, draft) ||
      validateCreateStep(2, draft) ||
      saving ||
      submitLock.current
    ) return;
    setSaving(true);
    setError("");
    try {
      const result = await submitCreateEventOnce(draft, submitLock, api.createEvent);
      if (!result) return;
      haptic();
      onCreated(result.event);
      navigate(createdEventPath(result.event.id), true);
    } catch (reason) {
      haptic("error");
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать встречу.",
      );
    } finally {
      setSaving(false);
    }
  }, [budgetLimit, description, hasParticipantLimit, maxParticipants, maxParticipantsInput, navigate, onCreated, places, saving, timeOptions, title, visibility]);
  return (
    <main className="create-screen">
      <Header navigate={navigate} onBack={onBack} title="Создание встречи" variant="nested" />
      <section className="create-intro">
        <p className="create-step-label">Шаг {step} из 3</p>
        <h1>{step === 1 ? "Что планируем?" : step === 2 ? "Когда встречаемся?" : "Где и сколько?"}</h1>
        {step === 2 && (
          <p className="create-step-description">
            Добавьте несколько вариантов дат, чтобы участники могли выбрать удобное время.
          </p>
        )}
        <div className="step-progress" aria-label={`Шаг ${step} из 3`}>
          <span style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </section>
      <form
        className="form-page create-wizard"
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 3) next();
          else void submit();
        }}
      >
        {step === 1 && <section className="panel wizard-panel">
          <label className="field">
            <span>Название встречи</span>
            <input
              autoFocus
              placeholder="Например, шашлыки с друзьями"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Описание (необязательно)</span>
            <textarea
              placeholder="Добавьте детали, чтобы все были в курсе…"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <fieldset className="visibility-selector">
            <legend>Кто сможет присоединиться?</legend>
            <button
              aria-pressed={visibility === "private"}
              className={`visibility-option${visibility === "private" ? " selected" : ""}`}
              onClick={() => {
                setVisibility("private");
                setHasParticipantLimit(false);
              }}
              type="button"
            >
              <span className="visibility-option-title"><strong>По приглашению</strong><span className="visibility-option-mark" aria-hidden="true">{visibility === "private" && <Check size={16} />}</span></span>
              <span>Встречу увидят только те, кому вы отправите ссылку</span>
            </button>
            <button
              aria-pressed={visibility === "public"}
              className={`visibility-option${visibility === "public" ? " selected" : ""}`}
              onClick={() => {
                if (visibility !== "public") {
                  setHasParticipantLimit(true);
                  setMaxParticipantsInput((current) => current || "6");
                }
                setVisibility("public");
              }}
              type="button"
            >
              <span className="visibility-option-title"><strong>Открытая встреча</strong><span className="visibility-option-mark" aria-hidden="true">{visibility === "public" && <Check size={16} />}</span></span>
              <span>Пользователи «Соберёмся» смогут найти встречу и отправить заявку</span>
            </button>
          </fieldset>
          {visibility === "public" && (
            <fieldset className="capacity-selector">
              <legend>Сколько человек может быть на встрече?</legend>
              <p>Всего людей, включая вас</p>
              <label className="capacity-option">
                <input
                  checked={hasParticipantLimit}
                  name="capacity"
                  onChange={() => {
                    setHasParticipantLimit(true);
                    setMaxParticipantsInput((current) => current || "6");
                  }}
                  type="radio"
                />
                <span>Ограничить</span>
                <input
                  aria-label="Лимит участников"
                  disabled={!hasParticipantLimit}
                  inputMode="numeric"
                  onChange={(event) =>
                    setMaxParticipantsInput(normalizeNumericInput(event.target.value))
                  }
                  pattern="[0-9]*"
                  type="text"
                  value={maxParticipantsInput}
                />
              </label>
              <label className="capacity-option">
                <input
                  checked={!hasParticipantLimit}
                  name="capacity"
                  onChange={() => setHasParticipantLimit(false)}
                  type="radio"
                />
                <span>Без ограничения</span>
              </label>
            </fieldset>
          )}
        </section>}
        {step === 2 && <section className="wizard-time-panel">
          <div className="section-row create-section-heading">
            <div>
              <h2>Варианты времени</h2>
              <p>Добавьте хотя бы один вариант, чтобы участники могли выбрать удобное время.</p>
            </div>
            <Clock3 aria-hidden="true" size={24} />
          </div>
          {!hasValidTimeOption && (
            <p className="create-inline-hint" role="status">
              Добавьте хотя бы один вариант даты и времени, чтобы продолжить.
            </p>
          )}
          <SlotBuilder
            slots={timeOptions}
            onChange={(nextOptions) => {
              setTimeOptions(nextOptions);
              if (nextOptions.length) setError("");
            }}
          />
        </section>}
        {step === 3 && <section className="panel wizard-panel">
          <div className="section-row">
            <div>
              <h2>Места</h2>
              <p className="create-section-helper">Места необязательны. Добавьте варианты, если участникам нужно выбрать локацию.</p>
            </div>
            <MapPin aria-hidden="true" size={24} />
          </div>
          {!places.length && (
            <p className="create-empty-options">Пока нет добавленных мест.</p>
          )}
          {places.map((place, index) => (
            <div className="place-draft" key={index}>
              <label className="field">
                <span>Место</span>
                <input
                  placeholder="Название места"
                  value={place.title}
                  onChange={(event) =>
                    setPlaces(
                      places.map((item, i) =>
                        i === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Район или метро</span>
                <input
                  placeholder="Район, метро или ориентир"
                  value={place.area}
                  onChange={(event) =>
                    setPlaces(
                      places.map((item, i) =>
                        i === index
                          ? { ...item, area: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Бюджет этого места, BYN</span>
                <input
                  min="0"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Например, 30"
                  type="text"
                  value={place.estimatedBudget}
                  onChange={(event) =>
                    setPlaces(
                      places.map((item, i) =>
                        i === index
                            ? {
                              ...item,
                              estimatedBudget: normalizeNumericInput(event.target.value),
                            }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              {places.length > 0 && (
                <button
                  className="icon-action danger"
                  onClick={() =>
                    setPlaces(places.filter((_, i) => i !== index))
                  }
                  title="Удалить место"
                  type="button"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
          <button
            className="add-place-action"
            onClick={() =>
              setPlaces([
                ...places,
                { title: "", area: "", estimatedBudget: budgetLimitInput },
              ])
            }
            type="button"
          >
            <Plus size={22} />
            Добавить место
          </button>
          <label className="field budget-field">
            <span>Общий бюджет встречи, BYN</span>
            <small>Общий ориентир для всей встречи. Бюджет места выше задаётся отдельно.</small>
            <input
              inputMode="numeric"
              onChange={(event) =>
                setBudgetLimitInput(normalizeNumericInput(event.target.value))
              }
              pattern="[0-9]*"
              placeholder="Например, 30"
              type="text"
              value={budgetLimitInput}
            />
          </label>
        </section>}
        <ErrorNote message={error} />
        <div className={`wizard-actions${step === 2 ? " step-2-actions" : ""}`}>
          {step === 3 && (
            <button className="secondary-action" disabled={saving} onClick={() => { setError(""); setStep((current) => previousCreateStep(current)); }} type="button">
              Назад
            </button>
          )}
          <button
            className="primary-action"
            disabled={saving || (step === 2 && !hasValidTimeOption)}
            type="submit"
          >
            {step < 3 ? "Продолжить" : saving ? "Создаём…" : "Создать встречу"}
          </button>
        </div>
      </form>
    </main>
  );
}

function useEvent(eventId: string) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const result = await api.event(eventId);
        setEvent(result.event);
        setError("");
        setLastUpdated(new Date());
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить встречу.",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [eventId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { event, setEvent, error, setError, refreshing, lastUpdated, load };
}

function useParticipantEvent(eventId: string) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [preview, setPreview] = useState<PublicEventPreview | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.event(eventId);
      setEvent(result.event);
      setPreview(null);
      setError("");
    } catch (reason) {
      if (!hasApiErrorCode(reason, "PUBLIC_PREVIEW_REQUIRED")) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить встречу.",
        );
        return;
      }
      try {
        const result = await api.publicEventPreview(eventId);
        setEvent(null);
        setPreview(result.preview);
        setError("");
      } catch (previewError) {
        setError(
          previewError instanceof Error
            ? previewError.message
            : "Не удалось загрузить встречу.",
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [eventId]);
  useEffect(() => {
    void load();
  }, [load]);
  return {
    event,
    setEvent,
    preview,
    setPreview,
    error,
    setError,
    refreshing,
    load,
  };
}

function Refresh({
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

function Created({
  eventId,
  navigate,
  event,
  onBack,
}: {
  eventId: string;
  navigate: Navigate;
  event: EventData | null;
  onBack: () => void;
}) {
  const link = miniAppLink(eventId);
  return (
    <main className="created-screen">
      <Header navigate={navigate} onBack={onBack} title="Встреча создана" variant="nested" />
      <section className="created-page">
        <span className="created-success-icon"><Check size={52} strokeWidth={2.4} /></span>
        <div className="created-copy">
          <h1>Встреча создана 🎉</h1>
          {event?.visibility === "public" && <span className="visibility-badge">Открытая</span>}
          <p>Всё готово! Теперь можно приглашать друзей.</p>
        </div>
        <div className="created-link-card">
          <span>Ссылка-приглашение</span>
          <code>{link}</code>
        </div>
        <div className="created-actions">
          <button
            className="primary-action"
            onClick={() => shareEvent(eventId)}
            type="button"
          >
            <Send size={20} />
            Поделиться в Telegram
          </button>
          <button
            className="secondary-action"
            onClick={() => navigate(managementPath(eventId))}
            type="button"
          >
            Перейти к встрече
          </button>
        </div>
      </section>
    </main>
  );
}

function PublicPreviewScreen({
  error,
  joining,
  navigate,
  onBack,
  onJoin,
  preview,
}: {
  error: string;
  joining: boolean;
  navigate: Navigate;
  onBack: () => void;
  onJoin: () => void;
  preview: PublicEventPreview;
}) {
  const requestView = publicJoinRequestView(
    preview.status,
    preview.joinRequestStatus,
  );
  return (
    <main className="public-preview-screen">
      <Header navigate={navigate} onBack={onBack} title="Открытая встреча" variant="nested" />
      <section className="public-preview-page">
        <div className="public-preview-heading">
          <div className="event-meta">
            <span className="visibility-badge">Открытая</span>
            <StatusBadge status={preview.status} />
          </div>
          <h1>{preview.title}</h1>
          {preview.description && <p>{preview.description}</p>}
        </div>
        <section className="panel public-preview-details">
          <div className="public-preview-row">
            <CalendarDays size={22} />
            <div>
              <span>Когда</span>
              <strong>{preview.dateSummary ?? "Дата пока не указана"}</strong>
            </div>
          </div>
          <div className="public-preview-row">
            <Users size={22} />
            <div>
              <span>Участники</span>
              <strong>
                {preview.maxParticipants === null
                  ? plural(preview.participantCount, "участник", "участника", "участников")
                  : `${preview.participantCount} из ${preview.maxParticipants} участников`}
              </strong>
            </div>
          </div>
          <div className="public-preview-budget">
            {preview.budgetLimit > 0
              ? `Ориентир до ${preview.budgetLimit} BYN`
              : "Бюджет не указан"}
          </div>
        </section>
        <section className="public-preview-request">
          <div className="public-preview-notice">
            <strong>{requestView.message}</strong>
            {requestView.supportingText && <span>{requestView.supportingText}</span>}
          </div>
          {requestView.actionLabel && (
            <button
              className="primary-action public-preview-join-action"
              disabled={joining}
              onClick={onJoin}
              type="button"
            >
              {joining ? "Отправляем…" : requestView.actionLabel}
            </button>
          )}
          <ErrorNote message={error} />
        </section>
      </section>
    </main>
  );
}

function localProposalDefaults() {
  const today = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    time: "18:30",
  };
}

function ParticipantTimeProposal({
  eventId,
  onProposed,
}: {
  eventId: string;
  onProposed: (event: EventData) => void;
}) {
  const defaults = localProposalDefaults();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const openProposal = () => {
    const next = localProposalDefaults();
    setDate(next.date);
    setTime(next.time);
    setError("");
    setOpen(true);
  };
  const submit = async () => {
    const startsAt = createTimeOption(date, time);
    if (!startsAt) {
      setError("Выберите корректные дату и время.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.proposeTimeOption(eventId, startsAt);
      onProposed(result.event);
      setOpen(false);
      haptic();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось предложить время.");
      haptic("error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="participant-option-proposal">
      <button className="secondary-action" onClick={openProposal} type="button">
        <Plus size={18} />
        Предложить время
      </button>
      {open && (
        <div className="time-picker-backdrop" role="presentation">
          <section aria-labelledby="participant-time-proposal-title" aria-modal="true" className="time-picker-dialog" role="dialog">
            <div className="section-row">
              <h2 id="participant-time-proposal-title">Предложить время</h2>
              <button aria-label="Закрыть предложение времени" className="icon-action" disabled={saving} onClick={() => setOpen(false)} type="button">×</button>
            </div>
            <label className="field">
              <span>Дата</span>
              <input min={defaults.date} onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
            <label className="field">
              <span>Время</span>
              <input onChange={(event) => setTime(event.target.value)} type="time" value={time} />
            </label>
            <ErrorNote message={error} />
            <div className="time-picker-actions">
              <button className="secondary-action" disabled={saving} onClick={() => setOpen(false)} type="button">Отмена</button>
              <button className="primary-action" disabled={saving} onClick={() => void submit()} type="button">{saving ? "Добавляем…" : "Предложить"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ParticipantPlaceProposal({
  eventId,
  eventBudget,
  onProposed,
}: {
  eventId: string;
  eventBudget: number;
  onProposed: (event: EventData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const openProposal = () => {
    setTitle("");
    setArea("");
    setBudgetInput(eventBudget > 0 ? String(eventBudget) : "");
    setError("");
    setOpen(true);
  };
  const submit = async () => {
    if (!title.trim()) {
      setError("Укажите место.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.proposePlaceOption(eventId, {
        title: title.trim(),
        area: area.trim(),
        estimatedBudget: nonNegativeIntegerFromInput(budgetInput),
      });
      onProposed(result.event);
      setOpen(false);
      haptic();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось предложить место.");
      haptic("error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="participant-option-proposal">
      <button className="secondary-action" onClick={openProposal} type="button">
        <Plus size={18} />
        Предложить место
      </button>
      {open && (
        <div className="participant-place-proposal">
          <label className="field">
            <span>Место</span>
            <input onChange={(event) => setTitle(event.target.value)} placeholder="Название места" value={title} />
          </label>
          <label className="field">
            <span>Район или метро</span>
            <input onChange={(event) => setArea(event.target.value)} placeholder="Район, метро или ориентир" value={area} />
          </label>
          <label className="field">
            <span>Бюджет этого места, BYN</span>
            <input inputMode="numeric" onChange={(event) => setBudgetInput(normalizeNumericInput(event.target.value))} pattern="[0-9]*" placeholder="Например, 30" type="text" value={budgetInput} />
          </label>
          <ErrorNote message={error} />
          <div className="participant-proposal-actions">
            <button className="secondary-action" disabled={saving} onClick={() => setOpen(false)} type="button">Отмена</button>
            <button className="primary-action" disabled={saving || !title.trim()} onClick={() => void submit()} type="button">{saving ? "Добавляем…" : "Предложить"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantEvent({
  eventId,
  navigate,
  onBack,
}: {
  eventId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const state = useParticipantEvent(eventId);
  const [area, setArea] = useState("");
  const [budgetInput, setBudgetInput] = useState("30");
  const [preferences, setPreferences] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [available, setAvailable] = useState<string[]>([]);
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const saveLock = useRef(false);
  const joinLock = useRef(false);
  const approvedReloadAttempted = useRef(false);
  const budget = nonNegativeIntegerFromInput(budgetInput);
  useEffect(() => {
    if (!state.event) return;
    const draft = votingDraftFromEvent(state.event);
    setArea(draft.area);
    setBudgetInput(draft.budget > 0 ? String(draft.budget) : "");
    setPreferences(draft.preferences);
    setRestrictions(draft.restrictions);
    setAvailable(draft.availableTimeOptionIds);
    setSelectedPlaces(draft.selectedPlaceOptionIds);
  }, [state.event]);
  useEffect(() => {
    if (
      state.preview?.joinRequestStatus !== "approved" ||
      approvedReloadAttempted.current
    )
      return;
    approvedReloadAttempted.current = true;
    void state.load();
  }, [state.load, state.preview?.joinRequestStatus]);
  const submitJoinRequest = useCallback(async () => {
    if (!state.preview || joining || joinLock.current) return;
    setJoining(true);
    state.setError("");
    try {
      const result = await createJoinRequestOnce(
        eventId,
        joinLock,
        api.createJoinRequest,
      );
      if (!result) return;
      if (result.joinRequestStatus === "approved") {
        approvedReloadAttempted.current = true;
        await state.load();
      } else {
        state.setPreview((current) =>
          current ? { ...current, joinRequestStatus: "pending" } : current,
        );
      }
      haptic();
    } catch (reason) {
      state.setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить заявку.",
      );
      haptic("error");
    } finally {
      setJoining(false);
    }
  }, [eventId, joining, state]);
  const submit = useCallback(async () => {
    if (!state.event || saving || saveLock.current) return;
    const draft: VotingDraft = {
      area,
      budget,
      preferences,
      restrictions,
      availableTimeOptionIds: available,
      selectedPlaceOptionIds: selectedPlaces,
    };
    setSaving(true);
    try {
      const result = await saveResponseOnce(
        eventId,
        draft,
        saveLock,
        api.saveResponse,
      );
      if (!result) return;
      state.setEvent(result.event);
      setSaved(true);
      haptic();
    } catch (reason) {
      state.setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить ответ.",
      );
      haptic("error");
    } finally {
      setSaving(false);
    }
  }, [
    area,
    available,
    budget,
    eventId,
    preferences,
    restrictions,
    selectedPlaces,
    saving,
    state,
  ]);
  useMainButton(
    saving ? "Сохраняем…" : "Отправить ответ",
    Boolean(state.event && !saving && state.event.status === "collecting"),
    submit,
    Boolean(state.event && !saved && state.event.status === "collecting"),
  );
  if (!state.event) {
    if (state.preview)
      return (
        <PublicPreviewScreen
          error={state.error}
          joining={joining}
          navigate={navigate}
          onBack={onBack}
          onJoin={() => void submitJoinRequest()}
          preview={state.preview}
        />
      );
    return (
      <main className="voting-screen">
        <Header navigate={navigate} onBack={onBack} title="Встреча" variant="nested" />
        {state.error ? (
          <RetryState
            message={state.error}
            onRetry={() => void state.load()}
            title="Встреча не загрузилась"
          />
        ) : (
          <Loading label="Загружаем встречу…" />
        )}
      </main>
    );
  }
  const event = state.event;
  const canProposeOptions = !event.canManage && event.status === "collecting";
  if (event.status !== "collecting")
    return <Result eventId={eventId} navigate={navigate} onBack={onBack} initial={event} />;
  if (saved)
    return (
      <main className="voting-screen voting-saved-screen">
        <Header navigate={navigate} onBack={onBack} title="Встреча" variant="nested" />
        <section className="voting-saved-page">
          <span className="voting-saved-icon"><Check size={44} /></span>
          <p className="create-step-label">Ваш ответ сохранён</p>
          <h1>Спасибо!</h1>
          <p className="voting-saved-summary">
            {bestSlot(event)
              ? `Сейчас лучше всего подходит ${formatSlot(bestSlot(event)!.startsAt)}.`
              : "Результаты появятся после ответов."}
          </p>
          <div className="voting-saved-actions">
            <button
              className="secondary-action"
              onClick={() => setSaved(false)}
              type="button"
            >
              Изменить мой ответ
            </button>
            <button
              className="secondary-action"
              onClick={() => navigate(`/result/${eventId}`)}
              type="button"
            >
              Посмотреть рекомендацию
            </button>
          </div>
        </section>
      </main>
    );
  return (
    <main className="voting-screen">
      <Header navigate={navigate} onBack={onBack} title="Встреча" variant="nested" />
      <section className="voting-intro">
        <p className="create-step-label">Вас приглашают</p>
        <h1>{event.title}</h1>
        {event.description && <p>{event.description}</p>}
      <div className="event-meta">
          <StatusBadge status={event.status} />
          <span>{plural(event.participants.length, "ответ", "ответа", "ответов")}</span>
        </div>
        <div className="participant-next-action">
          <strong>{event.myResponse ? "Ваш ответ сохранён" : "Нужно ответить"}</strong>
          <span>
            {event.myResponse
              ? "Вы можете изменить его, если ваши планы поменялись."
              : "Выберите подходящие даты и заполните пожелания ниже."}
          </span>
        </div>
      </section>
      <form
        className="form-page participant-form voting-form"
        onSubmit={(form) => {
          form.preventDefault();
          void submit();
        }}
      >
        <section className="panel voting-time-panel">
          <h2>Выберите подходящие даты</h2>
          <p className="panel-hint">Можно выбрать несколько вариантов.</p>
          <div className="availability-grid">
            {event.timeOptions.map((slot) => {
              const can = available.includes(slot.id);
              return (
                <button
                  className={`availability-card ${can ? "available" : ""}`}
                  aria-pressed={can}
                  key={slot.id}
                  onClick={() =>
                    setAvailable(toggleTimeOption(available, slot.id))
                  }
                  type="button"
                >
                  <span className="availability-check">
                    {can && <Check size={18} strokeWidth={3} />}
                  </span>
                  <strong>{formatSlot(slot.startsAt)}</strong>
                  <span className="availability-state">{can ? "Подходит" : "Не подходит"}</span>
                </button>
              );
            })}
          </div>
          {canProposeOptions && (
            <ParticipantTimeProposal
              eventId={eventId}
              onProposed={(nextEvent) => state.setEvent(nextEvent)}
            />
          )}
        </section>
        <section className="panel voting-place-panel">
          <h2>Выберите подходящие места</h2>
          <p className="panel-hint">Можно выбрать несколько вариантов.</p>
          {event.placeOptions.length ? (
            <div className="availability-grid">
              {event.placeOptions.map((place) => {
                const selected = selectedPlaces.includes(place.id);
                const details = [
                  place.area,
                  place.estimatedBudget > 0 ? `до ${place.estimatedBudget} BYN` : "",
                ].filter(Boolean).join(" · ");
                return (
                  <button
                    aria-pressed={selected}
                    className={`availability-card ${selected ? "available" : ""}`}
                    key={place.id}
                    onClick={() => setSelectedPlaces(toggleOption(selectedPlaces, place.id))}
                    type="button"
                  >
                    <span className="availability-check">
                      {selected && <Check size={18} strokeWidth={3} />}
                    </span>
                    <strong>{place.title}</strong>
                    <span className="availability-state">{details || "Без ориентира"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="participant-options-empty">Пока нет предложенных мест.</p>
          )}
          {canProposeOptions && (
            <ParticipantPlaceProposal
              eventBudget={event.budgetLimit}
              eventId={eventId}
              onProposed={(nextEvent) => state.setEvent(nextEvent)}
            />
          )}
        </section>
        <section className="panel voting-details-panel">
          <h2>Ваши пожелания</h2>
          <p className="panel-hint">Все поля ниже необязательны.</p>
          <label className="field">
            <span>Район или метро</span>
            <input
              value={area}
              placeholder="Район, метро или ориентир"
              onChange={(input) => setArea(input.target.value)}
            />
          </label>
          <label className="field">
            <span>Бюджет, BYN</span>
            <input
              inputMode="numeric"
              onChange={(input) =>
                setBudgetInput(normalizeNumericInput(input.target.value))
              }
              pattern="[0-9]*"
              placeholder="Например, 30"
              type="text"
              value={budgetInput}
            />
          </label>
          <label className="field">
            <span>Предпочтения</span>
            <textarea
              rows={2}
              value={preferences}
              placeholder="Например, тихий стол или веранда"
              onChange={(input) => setPreferences(input.target.value)}
            />
          </label>
          <label className="field">
            <span>Ограничения</span>
            <textarea
              rows={2}
              value={restrictions}
              placeholder="Например, без орехов"
              onChange={(input) => setRestrictions(input.target.value)}
            />
          </label>
        </section>
        <ErrorNote message={state.error} />
        <button
          className="primary-action form-submit"
          disabled={saving}
          type="submit"
        >
          {saving
            ? "Сохраняем…"
            : event.myResponse
              ? "Обновить ответ"
              : "Отправить ответ"}
        </button>
        <LeaveMeetingAction event={event} eventId={eventId} navigate={navigate} />
      </form>
    </main>
  );
}

function LeaveMeetingAction({
  event,
  eventId,
  navigate,
}: {
  event: EventData;
  eventId: string;
  navigate: Navigate;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const leaveLock = useRef(false);
  if (!canLeaveMeeting(event)) return null;
  const leave = async () => {
    if (leaving || leaveLock.current) return;
    if (
      !window.confirm(
        "Покинуть встречу?\nВаше участие и голоса будут удалены.",
      )
    )
      return;
    setError("");
    setLeaving(true);
    try {
      const result = await leaveMeetingOnce(
        eventId,
        leaveLock,
        api.leaveParticipation,
      );
      if (!result || !result.left) throw new Error("Leave request failed");
      haptic();
      navigate("/my-events");
    } catch {
      setError("Не удалось покинуть встречу. Попробуйте ещё раз.");
      haptic("error");
    } finally {
      setLeaving(false);
    }
  };
  return (
    <div className="leave-meeting-action">
      <button
        className="quiet-danger-action"
        disabled={leaving}
        onClick={() => void leave()}
        type="button"
      >
        {leaving ? "Выходим…" : "Покинуть встречу"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function MyEvents({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  type MeetingPageState = {
    items: MeetingListItem[];
    nextCursor: string | null;
    initialized: boolean;
    loading: boolean;
    loadingMore: boolean;
    error: string;
  };
  const emptyPage = (): MeetingPageState => ({
    items: [],
    nextCursor: null,
    initialized: false,
    loading: false,
    loadingMore: false,
    error: "",
  });
  const [pages, setPages] = useState<Record<MeetingListItem["role"], MeetingPageState>>({
    owner: emptyPage(),
    participant: emptyPage(),
  });
  const [selectedRole, setSelectedRole] = useState<MeetingListItem["role"]>(
    "owner",
  );
  const load = useCallback(async (role: MeetingListItem["role"], cursor?: string) => {
    const loadingMore = Boolean(cursor);
    setPages((current) => ({
      ...current,
      [role]: {
        ...current[role],
        loading: !loadingMore,
        loadingMore,
        error: "",
      },
    }));
    try {
      const result = await api.meetingsPage(role, cursor);
      setPages((current) => ({
        ...current,
        [role]: {
          ...current[role],
          items: loadingMore
            ? mergeMeetingItems(current[role].items, result.items)
            : mergeMeetingItems([], result.items),
          nextCursor: result.nextCursor,
          initialized: true,
          loading: false,
          loadingMore: false,
          error: "",
        },
      }));
    } catch (reason) {
      setPages((current) => ({
        ...current,
        [role]: {
          ...current[role],
          initialized: current[role].initialized,
          loading: false,
          loadingMore: false,
          error:
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить встречи.",
        },
      }));
    }
  }, []);
  useEffect(() => {
    void load("owner");
  }, [load]);
  const selectedPage = pages[selectedRole];
  const selectRole = (role: MeetingListItem["role"]) => {
    setSelectedRole(role);
    if (!pages[role].initialized && !pages[role].loading)
      void load(role);
  };
  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Соберёмся" variant="root" />
      <section className="my-meetings-page">
        <h1>Мои встречи</h1>
        <div aria-label="Тип встреч" className="meeting-segments" role="tablist">
          <button
            aria-selected={selectedRole === "owner"}
            className={selectedRole === "owner" ? "selected" : ""}
            onClick={() => selectRole("owner")}
            role="tab"
            type="button"
          >
            Организую
          </button>
          <button
            aria-selected={selectedRole === "participant"}
            className={selectedRole === "participant" ? "selected" : ""}
            onClick={() => selectRole("participant")}
            role="tab"
            type="button"
          >
            Участвую
          </button>
        </div>
        {selectedPage.loading && !selectedPage.items.length && <Loading />}
        {selectedPage.error && !selectedPage.items.length && (
          <RetryState
            message={selectedPage.error}
            onRetry={() => void load(selectedRole)}
            title="Не удалось загрузить список"
          />
        )}
        {selectedPage.initialized && (
          <MeetingGroup
            emptyText={
              selectedRole === "owner"
                ? "Создайте встречу и пригласите участников."
                : "Здесь появятся встречи, в которых вы участвуете."
            }
            items={selectedPage.items}
            navigate={navigate}
            showAction
          />
        )}
        {selectedPage.error && selectedPage.items.length > 0 && (
          <div className="my-meetings-pagination-error" role="alert">
            <span>{selectedPage.error}</span>
            <button
              className="secondary-action compact-action"
              onClick={() => void load(selectedRole, selectedPage.nextCursor ?? undefined)}
              type="button"
            >
              Повторить
            </button>
          </div>
        )}
        {selectedPage.nextCursor && !selectedPage.error && (
          <button
            className="secondary-action my-meetings-load-more"
            disabled={selectedPage.loadingMore}
            onClick={() => void load(selectedRole, selectedPage.nextCursor!)}
            type="button"
          >
            {selectedPage.loadingMore ? "Загружаем…" : "Загрузить ещё"}
          </button>
        )}
      </section>
      <BottomNavigation currentPath="/my-events" navigate={navigate} />
    </main>
  );
}

function Manage({
  eventId,
  navigate,
  onBack,
}: {
  eventId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const state = useEvent(eventId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newTime, setNewTime] = useState("");
  const [place, setPlace] = useState<EditablePlaceDraft>({
    title: "",
    area: "",
    estimatedBudget: "30",
  });
  const [finalTime, setFinalTime] = useState("");
  const [finalPlace, setFinalPlace] = useState("");
  const [saving, setSaving] = useState(false);
  const [timeRemovalError, setTimeRemovalError] = useState("");
  const [placeRemovalError, setPlaceRemovalError] = useState("");
  const [participantToRemove, setParticipantToRemove] = useState<OrganizerParticipant | null>(null);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);
  const [participantRemovalError, setParticipantRemovalError] = useState("");
  const actionLock = useRef(false);
  useEffect(() => {
    if (state.lastUpdated) {
      setTimeRemovalError("");
      setPlaceRemovalError("");
    }
  }, [state.lastUpdated]);
  useEffect(() => {
    if (!state.event) return;
    setTitle(state.event.title);
    setDescription(state.event.description);
    setFinalTime(state.event.finalTimeOptionId ?? "");
    setFinalPlace(state.event.finalPlaceId ?? "");
  }, [
    state.event?.id,
    state.event?.finalPlaceId,
    state.event?.finalTimeOptionId,
  ]);
  const mutate = async (payload: unknown, removalKind?: "time" | "place") => {
    if (actionLock.current) return false;
    if (removalKind === "time") setTimeRemovalError("");
    if (removalKind === "place") setPlaceRemovalError("");
    setSaving(true);
    try {
      const result = await runActionOnce(actionLock, () =>
        api.manage(eventId, payload),
      );
      if (!result) return false;
      state.setEvent(result.event);
      if (removalKind === "time") setTimeRemovalError("");
      if (removalKind === "place") setPlaceRemovalError("");
      haptic();
      return true;
    } catch (reason) {
      const message = reason instanceof Error
        ? reason.message
        : "Не удалось изменить встречу.";
      if (removalKind === "time") setTimeRemovalError(message);
      else if (removalKind === "place") setPlaceRemovalError(message);
      else state.setError(message);
      haptic("error");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const removeParticipant = async () => {
    if (!participantToRemove || removingParticipantId) return;
    const participantId = participantToRemove.id;
    setRemovingParticipantId(participantId);
    setParticipantRemovalError("");
    try {
      const result = await api.removeParticipant(eventId, participantId);
      if (!result.removed) throw new Error("Participant removal failed.");
      setParticipantToRemove(null);
      await state.load(true);
      haptic();
    } catch {
      setParticipantRemovalError(
        "Не удалось исключить участника. Попробуйте ещё раз.",
      );
      haptic("error");
    } finally {
      setRemovingParticipantId(null);
    }
  };
  if (!state.event)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} onBack={onBack} title="Управление встречей" variant="nested" />
        {state.error ? (
          <RetryState
            message={state.error}
            onRetry={() => void state.load()}
            title="Управление не загрузилось"
          />
        ) : (
          <Loading />
        )}
      </main>
    );
  const event = state.event;
  const missingDecisionOptions = [
    event.timeOptions.length ? "" : "время",
    event.placeOptions.length ? "" : "место",
  ].filter(Boolean);
  const decisionHint =
    event.status === "decided"
      ? "Итог выбран. При необходимости встречу можно возобновить."
      : missingDecisionOptions.length
        ? `Добавьте варианты: ${missingDecisionOptions.join(" и ")}, затем выберите итог.`
        : "Выберите итоговое время и место, когда будете готовы принять решение.";
  if (!event.canManage)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} onBack={onBack} title="Управление встречей" variant="nested" />
        <RetryState
          message="Управлять встречей может только её организатор."
          title="Нет доступа"
        />
      </main>
    );
  return (
    <main className="manage-screen">
      <Header navigate={navigate} onBack={onBack} title="Управление встречей" variant="nested" />
      <section className="manage-intro">
        <p className="create-step-label">Управление встречей</p>
        <h1>{event.title}</h1>
        {event.description && <p className="manage-description">{event.description}</p>}
        <div className="event-meta">
          <StatusBadge status={event.status} />
          {event.visibility === "public" && <span className="visibility-badge">Открытая</span>}
          <span>
            {plural(
              event.participants.length,
              "участник",
              "участника",
              "участников",
            )}
          </span>
        </div>
      </section>
      <section className="manage-page">
        <Refresh
          refreshing={state.refreshing}
          lastUpdated={state.lastUpdated}
          onClick={() => void state.load()}
        />
        <section className="manage-next-action" aria-labelledby="manage-next-action-title">
          <div>
            <p className="manage-section-kicker">Следующий шаг</p>
            <h2 id="manage-next-action-title">
              {event.status === "decided" ? "Решение принято" : "Подготовьте итог встречи"}
            </h2>
            <p>{decisionHint}</p>
          </div>
          <StatusBadge status={event.status} />
        </section>
        {event.visibility === "public" && event.canManage && (
          <OrganizerJoinRequests
            eventId={event.id}
            onApproved={() => state.load(true)}
          />
        )}
        <section className="panel manage-card manage-details-card">
          <h2><span>Описание</span><small>Основная информация о встрече</small></h2>
          <label className="field">
            <span>Название</span>
            <input
              value={title}
              onChange={(input) => setTitle(input.target.value)}
            />
          </label>
          <label className="field">
            <span>Комментарий</span>
            <textarea
              rows={3}
              value={description}
              onChange={(input) => setDescription(input.target.value)}
            />
          </label>
          <button
            className="secondary-action"
            disabled={saving}
            onClick={() =>
              void mutate(managePayloads.updateDetails(title, description))
            }
            type="button"
          >
            Сохранить описание
          </button>
        </section>
        <section className="panel manage-card manage-time-card">
          <h2><CalendarDays size={24} /><span>Время<small>Варианты, за которые могут голосовать участники</small></span></h2>
          {event.timeOptions.map((slot) => (
            <div className="slot-card" key={slot.id}>
              <div>
                <strong>{formatSlot(slot.startsAt)}</strong>
                <span>
                  {plural(slot.availableCount, "голос", "голоса", "голосов")}
                </span>
              </div>
              <button
                aria-label="Удалить вариант времени"
                className="icon-action danger"
                onClick={async () => {
                  if (
                    slot.availableCount &&
                    !confirm(
                      `За вариант проголосовали ${slot.availableCount}. Удалить его и голоса?`,
                    )
                  )
                    return;
                  await mutate(
                    managePayloads.removeTime(
                      slot.id,
                      slot.availableCount > 0,
                    ),
                    "time",
                  );
                }}
                title="Удалить время"
                type="button"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          <div className="inline-add">
            <input
              type="datetime-local"
              value={newTime}
              onChange={(input) => setNewTime(input.target.value)}
            />
            <button
              className="secondary-action"
              disabled={!newTime}
              onClick={async () => {
                if (
                  await mutate(
                    managePayloads.addTime(new Date(newTime).toISOString()),
                  )
                )
                  setNewTime("");
              }}
              type="button"
            >
              <Plus size={18} />
              Добавить
            </button>
          </div>
        </section>
        <ErrorNote message={timeRemovalError} />
        <section className="panel manage-card manage-places-card">
          <h2><MapPin size={24} /><span>Места<small>Варианты локации и ориентир по бюджету</small></span></h2>
          {!event.placeOptions.length && (
            <p className="manage-empty-options">Мест пока нет. Добавьте вариант, если участникам нужно выбрать локацию.</p>
          )}
          {event.placeOptions.map((item) => (
            <div className="slot-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.area} · до {item.estimatedBudget} BYN
                </span>
              </div>
              <button
                aria-label="Удалить вариант места"
                className="icon-action danger"
                onClick={() =>
                  void mutate(managePayloads.removePlace(item.id), "place")
                }
                title="Удалить место"
                type="button"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          <div className="add-place">
            <input
              placeholder="Место"
              value={place.title}
              onChange={(input) =>
                setPlace({ ...place, title: input.target.value })
              }
            />
            <input
              placeholder="Район"
              value={place.area}
              onChange={(input) =>
                setPlace({ ...place, area: input.target.value })
              }
            />
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="До, BYN"
              type="text"
              value={place.estimatedBudget}
              onChange={(input) =>
                setPlace({
                  ...place,
                  estimatedBudget: normalizeNumericInput(input.target.value),
                })
              }
            />
            <button
              className="secondary-action"
              disabled={!place.title.trim()}
              onClick={async () => {
                if (await mutate(managePayloads.addPlace({
                  ...place,
                  estimatedBudget: nonNegativeIntegerFromInput(place.estimatedBudget),
                })))
                  setPlace({
                    title: "",
                    area: "",
                    estimatedBudget: event.budgetLimit > 0 ? String(event.budgetLimit) : "",
                  });
              }}
              type="button"
            >
              <Plus size={18} />
              Добавить
            </button>
          </div>
        </section>
        <ErrorNote message={placeRemovalError} />
        <section className="panel manage-card manage-participants-card">
          <h2><Users size={24} /><span>Ответы участников<small>Разверните строку, чтобы посмотреть ответ и действия</small></span></h2>
          {event.participants.length ? (
            event.participants.map((person) => (
              <details className="participant-answer" key={person.id}>
                <summary>
                  <strong>{person.name}</strong>
                  <span>{person.area || "Район не указан"}</span>
                </summary>
                <div>
                  <p>
                    <b>Могу:</b>{" "}
                    {event.timeOptions
                      .filter((slot) =>
                        person.availableTimeOptionIds.includes(slot.id),
                      )
                      .map((slot) => formatSlot(slot.startsAt))
                      .join(" · ") || "нет"}
                  </p>
                  <p>
                    <b>Не могу:</b>{" "}
                    {event.timeOptions
                      .filter((slot) =>
                        person.unavailableTimeOptionIds.includes(slot.id),
                      )
                      .map((slot) => formatSlot(slot.startsAt))
                      .join(" · ") || "нет"}
                  </p>
                  <p>
                    <b>Бюджет:</b> {person.budget} BYN
                  </p>
                  <p>
                    <b>Предпочтения:</b> {person.preferences || "нет"}
                  </p>
                  <p>
                    <b>Ограничения:</b> {person.restrictions || "нет"}
                  </p>
                  {event.myResponse?.id !== person.id && (
                    <button
                      className="participant-remove-action"
                      disabled={removingParticipantId === person.id}
                      onClick={() => {
                        setParticipantRemovalError("");
                        setParticipantToRemove(person);
                      }}
                      type="button"
                    >
                      {removingParticipantId === person.id
                        ? "Исключаем…"
                        : "Исключить из встречи"}
                    </button>
                  )}
                </div>
              </details>
            ))
          ) : (
            <EmptyState
              text="Отправьте приглашение в чат — ответы появятся здесь."
              title="Ответов пока нет"
            />
          )}
        </section>
        {participantToRemove && (
          <div className="participant-remove-backdrop" role="presentation">
            <section
              aria-labelledby="participant-remove-title"
              aria-modal="true"
              className="participant-remove-dialog"
              role="dialog"
            >
              <h2 id="participant-remove-title">Исключить участника?</h2>
              <p>Его ответ и голоса будут удалены.</p>
              {participantRemovalError && (
                <p className="participant-remove-error" role="alert">
                  {participantRemovalError}
                </p>
              )}
              <div className="participant-remove-actions">
                <button
                  className="secondary-action"
                  disabled={Boolean(removingParticipantId)}
                  onClick={() => {
                    setParticipantRemovalError("");
                    setParticipantToRemove(null);
                  }}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="danger-button"
                  disabled={Boolean(removingParticipantId)}
                  onClick={() => void removeParticipant()}
                  type="button"
                >
                  {removingParticipantId ? "Исключаем…" : "Исключить"}
                </button>
              </div>
            </section>
          </div>
        )}
        <section className="panel manage-card decision-panel">
          <h2><Check size={24} /> <span>Окончательное решение<small>{event.status === "decided" ? "Итог встречи" : "Выберите финальные варианты"}</small></span></h2>
          <p className="decision-hint">{decisionHint}</p>
          <label className="field">
            <span>Время</span>
            <select
              value={finalTime}
              onChange={(input) => setFinalTime(input.target.value)}
            >
              <option value="">Выберите время</option>
              {event.timeOptions.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatSlot(slot.startsAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Место</span>
            <select
              value={finalPlace}
              onChange={(input) => setFinalPlace(input.target.value)}
            >
              <option value="">Выберите место</option>
              {event.placeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.area}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-action"
            disabled={!finalTime || !finalPlace || saving}
            onClick={() =>
              void mutate(managePayloads.decide(finalTime, finalPlace))
            }
            type="button"
          >
            Принять решение
          </button>
          {event.status === "collecting" && (
            <button
              className="secondary-action"
              onClick={() => void mutate(managePayloads.close())}
              type="button"
            >
              Закрыть сбор ответов
            </button>
          )}
          {event.status !== "collecting" && (
            <button
              className="secondary-action"
              onClick={() => void mutate(managePayloads.reopen())}
              type="button"
            >
              Возобновить сбор ответов
            </button>
          )}
        </section>
        <div className="action-row manage-actions">
          <div className="manage-secondary-actions">
            <p className="manage-section-kicker">Дополнительно</p>
            <button
              className="secondary-action"
              onClick={() => shareEvent(event.id)}
              type="button"
            >
              <Send size={18} />
              Отправить в чат
            </button>
            <button
              className="secondary-action"
              onClick={() => navigate(`/result/${event.id}`)}
              type="button"
            >
              Открыть результат
            </button>
          </div>
          <div className="manage-danger-zone">
            <p className="manage-section-kicker">Удаление</p>
            <p>Удаление встречи необратимо для всех участников.</p>
            <button
              className="danger-button"
              onClick={async () => {
                if (confirm("Удалить встречу?")) {
                  const removed = await runActionOnce(actionLock, () =>
                    api.remove(event.id),
                  );
                  if (removed) navigate("/my-events", true);
                }
              }}
              type="button"
            >
              <Trash2 size={18} />
              Удалить встречу
            </button>
          </div>
        </div>
        <ErrorNote message={state.error} />
      </section>
    </main>
  );
}

function Result({
  eventId,
  navigate,
  onBack,
  initial = null,
}: {
  eventId: string;
  navigate: Navigate;
  onBack: () => void;
  initial?: EventData | null;
}) {
  const state = useEvent(eventId);
  const [calendarError, setCalendarError] = useState("");
  const [calendarOpening, setCalendarOpening] = useState(false);
  const event = initial ?? state.event;
  if (!event)
    return (
      <main>
        <Header navigate={navigate} onBack={onBack} title="Итог встречи" variant="nested" />
        {state.error ? (
          <RetryState
            message={state.error}
            onRetry={() => void state.load()}
            title="Результат не загрузился"
          />
        ) : (
          <Loading />
        )}
      </main>
    );
  const recommendedTime = resultTime(event);
  const finalPlace = resultPlace(event);
  const areas = areaLeaders(event);
  const tie = areas.length > 1;
  const calendarDetails = () => {
    if (!recommendedTime) return;
    const start = new Date(recommendedTime.startsAt);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
      title: event.title,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      location: [finalPlace?.title, finalPlace?.area].filter(Boolean).join(", "),
      description: event.description || undefined,
    };
  };
  const addGoogleCalendar = () => {
    const details = calendarDetails();
    if (!details) return;
    openExternalUrl(
      googleCalendarUrl(details),
    );
  };
  const addAppleCalendar = async () => {
    setCalendarError("");
    setCalendarOpening(true);
    try {
      const { icsUrl } = await api.calendarLink(event.id);
      openExternalUrl(icsUrl);
    } catch {
      setCalendarError("Не удалось открыть календарь. Попробуйте ещё раз.");
    } finally {
      setCalendarOpening(false);
    }
  };
  return (
    <main className="result-screen">
      <Header navigate={navigate} onBack={onBack} title="Итог встречи" variant="nested" />
      <section className="result-page">
        {!initial && (
          <Refresh
            refreshing={state.refreshing}
            lastUpdated={state.lastUpdated}
            onClick={() => void state.load()}
          />
        )}
        <section className="result-success-intro">
          <span className="result-success-icon"><Check size={44} strokeWidth={2.5} /></span>
          <p className="create-step-label">
            {event.status === "decided" ? "Итог встречи" : "Текущая рекомендация"}
          </p>
          <h1>{event.status === "decided" ? "Решение принято" : event.title}</h1>
          {event.status === "decided" && <p className="result-event-title">{event.title}</p>}
        </section>
        <section className="result-summary-card">
          <div className="result-summary-row">
            <span className="result-summary-icon"><CalendarDays size={25} /></span>
            <div>
              <span>Дата и время</span>
              <strong>{recommendedTime ? formatSlot(recommendedTime.startsAt) : "Пока нет голосов"}</strong>
            </div>
          </div>
          <div className="result-summary-row">
            <span className="result-summary-icon"><MapPin size={25} /></span>
            <div>
              <span>Место</span>
              <strong>{finalPlace ? finalPlace.title : "Место ещё не выбрано"}</strong>
              {finalPlace?.area && <small>{finalPlace.area}</small>}
            </div>
          </div>
          <div className="result-summary-row">
            <span className="result-summary-icon"><Users size={25} /></span>
            <div>
              <span>Участники</span>
              <strong>{event.participants.length}</strong>
            </div>
          </div>
        </section>
        <div className="result-grid">
          <section className="panel">
            <MapPin size={22} />
            <h3>Район</h3>
            <strong className="result-value">
              {tie ? "Нет единого района" : (areas[0]?.[0] ?? "Нет данных")}
            </strong>
            {areas.map(([area, count]) => (
              <span key={area}>
                {area} — {plural(count, "голос", "голоса", "голосов")}
              </span>
            ))}
          </section>
          <section className="panel">
            <Clock3 size={22} />
            <h3>Могут прийти</h3>
            <strong className="result-value">
              {recommendedTime?.availableCount ?? 0}
            </strong>
          </section>
        </div>
        <section className="panel">
          <h2>Кто участвует</h2>
          <div className="name-list">
            {event.participants.map((person, index) => (
              <span key={`${person.name}-${index}`}>{person.name}</span>
            ))}
          </div>
        </section>
        <div className="result-actions">
          <button
            className="primary-action share-result-action"
            onClick={() => shareResult(event.id)}
            type="button"
          >
            <Send size={18} />
            Поделиться результатом
          </button>
          <button
            className="secondary-action calendar-action"
            onClick={addGoogleCalendar}
            type="button"
          >
            <CalendarPlus size={18} />
            Google Calendar
          </button>
          <button
            className="secondary-action calendar-action"
            disabled={calendarOpening}
            onClick={() => void addAppleCalendar()}
            type="button"
          >
            <CalendarPlus size={18} />
            Календарь iPhone
          </button>
          {calendarError && <p className="form-error">{calendarError}</p>}
          <LeaveMeetingAction event={event} eventId={eventId} navigate={navigate} />
          <button
            className="text-action result-home-action"
            onClick={() => navigate("/")}
            type="button"
          >
            Вернуться на главную
          </button>
        </div>
      </section>
    </main>
  );
}

function telegramAppConfig() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "BOT_USERNAME";
  const app = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME || "app";
  return { bot, app };
}

function miniAppLink(eventId: string) {
  const { bot, app } = telegramAppConfig();
  return buildMiniAppLink(eventId, bot, app);
}

function shareEvent(eventId: string) {
  const { bot, app } = telegramAppConfig();
  openTelegramUrl(buildEventShareUrl(eventId, bot, app));
}
function shareResult(eventId: string) {
  const { bot, app } = telegramAppConfig();
  openTelegramUrl(buildResultShareUrl(eventId, bot, app));
}

export default function App() {
  const { path, navigate, goBack } = usePath();
  const { resolvedTheme, toggleTheme } = useAppTheme();
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [createdEvent, setCreatedEvent] = useState<EventData | null>(null);
  useTelegramBack(path, goBack, backOverride);
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
        else {
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
    return <Created event={createdEvent?.id === created ? createdEvent : null} eventId={created} navigate={navigate} onBack={backOverride ?? goBack} />;
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
        onCreated={setCreatedEvent}
        setBackOverride={setBackOverride}
      />
    );
  if (path === "/open") return <PublicMeetings navigate={navigate} onBack={goBack} />;
  if (path === "/my-events") return <MyEvents navigate={navigate} onBack={goBack} />;
  return (
    <Home
      navigate={navigate}
      resolvedTheme={resolvedTheme}
      toggleTheme={toggleTheme}
      user={auth.user}
    />
  );
}
