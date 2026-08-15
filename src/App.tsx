import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
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
import { hasApiErrorCode } from "./api-error";
import { BottomNavigation } from "./BottomNavigation";
import { googleCalendarUrl } from "./calendar";
import {
  advanceCreateStep,
  addTimeOption,
  createdEventPath,
  previousCreateStep,
  removeTimeOption,
  submitCreateEventOnce,
  validateCreateStep,
  type CreateWizardDraft,
  type MeetingVisibility,
  type PlaceDraft,
} from "./create-wizard";
import { areaLeaders, bestSlot, formatSlot, plural } from "./domain";
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
  PublicEventPreview,
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
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const onHashChange = () => setPath(readPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = useCallback<Navigate>((next, replace = false) => {
    const target = `#${next}`;
    if (replace)
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${target}`);
    else window.location.hash = next;
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  return { path, navigate };
}

function useTelegramBack(
  path: string,
  navigate: Navigate,
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
      navigate("/");
    };
    if (path === "/") button.hide();
    else {
      button.show();
      button.onClick(back);
    }
    return () => button.offClick(back);
  }, [navigate, override, path]);
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
  resolvedTheme,
  toggleTheme,
}: {
  navigate: Navigate;
  resolvedTheme?: ResolvedTheme;
  toggleTheme?: () => void;
}) {
  return (
    <header className="topbar">
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
          title={
            resolvedTheme === "dark"
              ? "Светлая тема"
              : "Тёмная тема"
          }
          type="button"
        >
          {resolvedTheme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      )}
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
            <span>
              <strong>Создать встречу</strong>
              <small>Организуйте новое событие с друзьями</small>
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

function MeetingGroup({
  items,
  navigate,
  title,
  emptyText = "Здесь пока ничего нет.",
}: {
  items: MeetingListItem[];
  navigate: Navigate;
  title?: string;
  emptyText?: string;
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
  const defaultDate = today.toISOString().slice(0, 10);
  const defaultTime = "18:30";
  const slotValues = (slot: string) => {
    const value = new Date(slot);
    const pad = (part: number) => String(part).padStart(2, "0");
    return {
      date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
    };
  };
  const change = (slot: string, nextDate: string, nextTime: string) => {
    const value = new Date(`${nextDate}T${nextTime}:00`).toISOString();
    onChange(addTimeOption(removeTimeOption(slots, slot), value));
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
        onClick={() =>
          onChange(
            addTimeOption(
              slots,
              new Date(`${defaultDate}T${defaultTime}:00`).toISOString(),
            ),
          )
        }
        type="button"
      >
        <Plus size={18} />
        Добавить вариант
      </button>
    </div>
  );
}

function CreateEvent({
  navigate,
  setBackOverride,
  onCreated,
}: {
  navigate: Navigate;
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
  const [places, setPlaces] = useState<EditablePlaceDraft[]>([
    { title: "", area: "", estimatedBudget: "30" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const budgetLimit = nonNegativeIntegerFromInput(budgetLimitInput);
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
      <Header navigate={navigate} />
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
              <strong>По приглашению</strong>
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
              <strong>Открытая встреча</strong>
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
            <h2>Места</h2>
          </div>
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
                <span>До, BYN</span>
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
              {places.length > 1 && (
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
            <span>Общий бюджет, BYN</span>
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
          <button className="secondary-action" disabled={saving} type="submit">
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
}: {
  eventId: string;
  navigate: Navigate;
  event: EventData | null;
}) {
  const link = miniAppLink(eventId);
  return (
    <main className="created-screen">
      <Header navigate={navigate} />
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
  onJoin,
  preview,
}: {
  error: string;
  joining: boolean;
  navigate: Navigate;
  onJoin: () => void;
  preview: PublicEventPreview;
}) {
  const requestView = publicJoinRequestView(
    preview.status,
    preview.joinRequestStatus,
  );
  return (
    <main className="public-preview-screen">
      <Header navigate={navigate} />
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
              className="secondary-action"
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

function ParticipantEvent({
  eventId,
  navigate,
}: {
  eventId: string;
  navigate: Navigate;
}) {
  const state = useParticipantEvent(eventId);
  const [area, setArea] = useState("");
  const [budgetInput, setBudgetInput] = useState("30");
  const [preferences, setPreferences] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [available, setAvailable] = useState<string[]>([]);
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
  }, [state.event?.id]);
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
          onJoin={() => void submitJoinRequest()}
          preview={state.preview}
        />
      );
    return (
      <main className="voting-screen">
        <Header navigate={navigate} />
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
  if (event.status !== "collecting")
    return <Result eventId={eventId} navigate={navigate} initial={event} />;
  if (saved)
    return (
      <main className="voting-screen voting-saved-screen">
        <Header navigate={navigate} />
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
      <Header navigate={navigate} />
      <section className="voting-intro">
        <p className="create-step-label">Вас приглашают</p>
        <h1>{event.title}</h1>
        {event.description && <p>{event.description}</p>}
        <div className="event-meta">
          <StatusBadge status={event.status} />
          <span>{plural(event.participants.length, "ответ", "ответа", "ответов")}</span>
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
          className="secondary-action form-submit"
          disabled={saving}
          type="submit"
        >
          {saving
            ? "Сохраняем…"
            : event.myResponse
              ? "Обновить ответ"
              : "Отправить ответ"}
        </button>
      </form>
    </main>
  );
}

function MyEvents({ navigate }: { navigate: Navigate }) {
  const [data, setData] = useState<{
    owned: MeetingListItem[];
    participating: MeetingListItem[];
  } | null>(null);
  const [error, setError] = useState("");
  const [selectedRole, setSelectedRole] = useState<MeetingListItem["role"]>(
    "owner",
  );
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
  const selectedItems =
    selectedRole === "owner" ? (data?.owned ?? []) : (data?.participating ?? []);
  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} />
      <section className="my-meetings-page">
        <h1>Мои встречи</h1>
        <div aria-label="Тип встреч" className="meeting-segments" role="tablist">
          <button
            aria-selected={selectedRole === "owner"}
            className={selectedRole === "owner" ? "selected" : ""}
            onClick={() => setSelectedRole("owner")}
            role="tab"
            type="button"
          >
            Организую
          </button>
          <button
            aria-selected={selectedRole === "participant"}
            className={selectedRole === "participant" ? "selected" : ""}
            onClick={() => setSelectedRole("participant")}
            role="tab"
            type="button"
          >
            Участвую
          </button>
        </div>
        {!data && !error && <Loading />}
        {error && (
          <RetryState
            message={error}
            onRetry={() => void load()}
            title="Не удалось загрузить список"
          />
        )}
        {data && (
          <MeetingGroup
            emptyText={
              selectedRole === "owner"
                ? "Создайте встречу и пригласите участников."
                : "Здесь появятся встречи, в которых вы участвуете."
            }
            items={selectedItems}
            navigate={navigate}
          />
        )}
      </section>
      <BottomNavigation currentPath="/my-events" navigate={navigate} />
    </main>
  );
}

function Manage({
  eventId,
  navigate,
}: {
  eventId: string;
  navigate: Navigate;
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
  const actionLock = useRef(false);
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
  const mutate = async (payload: unknown) => {
    if (actionLock.current) return false;
    setSaving(true);
    try {
      const result = await runActionOnce(actionLock, () =>
        api.manage(eventId, payload),
      );
      if (!result) return false;
      state.setEvent(result.event);
      haptic();
      return true;
    } catch (reason) {
      state.setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить встречу.",
      );
      haptic("error");
      return false;
    } finally {
      setSaving(false);
    }
  };
  if (!state.event)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} />
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
  if (!event.canManage)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} />
        <RetryState
          message="Управлять встречей может только её организатор."
          title="Нет доступа"
        />
      </main>
    );
  return (
    <main className="manage-screen">
      <Header navigate={navigate} />
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
        {event.visibility === "public" && event.canManage && (
          <OrganizerJoinRequests
            eventId={event.id}
            onApproved={() => state.load(true)}
          />
        )}
        <section className="panel manage-card manage-details-card">
          <h2>Описание</h2>
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
          <h2><CalendarDays size={24} /> Время</h2>
          {event.timeOptions.map((slot) => (
            <div className="slot-card" key={slot.id}>
              <div>
                <strong>{formatSlot(slot.startsAt)}</strong>
                <span>
                  {plural(slot.availableCount, "голос", "голоса", "голосов")}
                </span>
              </div>
              <button
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
        <section className="panel manage-card manage-places-card">
          <h2><MapPin size={24} /> Места</h2>
          {event.placeOptions.map((item) => (
            <div className="slot-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.area} · до {item.estimatedBudget} BYN
                </span>
              </div>
              <button
                className="icon-action danger"
                onClick={() =>
                  void mutate(managePayloads.removePlace(item.id))
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
        <section className="panel manage-card manage-participants-card">
          <h2><Users size={24} /> Ответы участников</h2>
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
        <section className="panel manage-card decision-panel">
          <h2>Окончательное решение</h2>
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
            className="secondary-action"
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
          <button
            className="primary-action"
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
        <ErrorNote message={state.error} />
      </section>
    </main>
  );
}

function Result({
  eventId,
  navigate,
  initial = null,
}: {
  eventId: string;
  navigate: Navigate;
  initial?: EventData | null;
}) {
  const state = useEvent(eventId);
  const [calendarError, setCalendarError] = useState("");
  const [calendarOpening, setCalendarOpening] = useState(false);
  const event = initial ?? state.event;
  if (!event)
    return (
      <main>
        <Header navigate={navigate} />
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
      <Header navigate={navigate} />
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
            {event.participants.map((person) => (
              <span key={person.id}>{person.name}</span>
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
  const { path, navigate } = usePath();
  const { resolvedTheme, toggleTheme } = useAppTheme();
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [createdEvent, setCreatedEvent] = useState<EventData | null>(null);
  useTelegramBack(path, navigate, backOverride);
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
    return <Created event={createdEvent?.id === created ? createdEvent : null} eventId={created} navigate={navigate} />;
  const manage = match(/^\/manage\/([^/]+)$/);
  if (manage) return <Manage eventId={manage} navigate={navigate} />;
  const result = match(/^\/result\/([^/]+)$/);
  if (result) return <Result eventId={result} navigate={navigate} />;
  const event = match(/^\/event\/([^/]+)$/);
  if (event) return <ParticipantEvent eventId={event} navigate={navigate} />;
  if (path === "/create")
    return (
      <CreateEvent
        navigate={navigate}
        onCreated={setCreatedEvent}
        setBackOverride={setBackOverride}
      />
    );
  if (path === "/my-events") return <MyEvents navigate={navigate} />;
  return (
    <Home
      navigate={navigate}
      resolvedTheme={resolvedTheme}
      toggleTheme={toggleTheme}
      user={auth.user}
    />
  );
}
