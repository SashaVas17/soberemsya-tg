import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { api } from "../api";
import { askWriteAccessOnce } from "../write-access";
import { createTimeOption } from "../create-wizard";
import { bestSlot, formatSlot, plural } from "../domain";
import { managementPath } from "../meeting-links";
import { nonNegativeIntegerFromInput, normalizeNumericInput } from "../numeric-input";
import { createJoinRequestOnce } from "../join-request";
import {
  saveResponseOnce,
  toggleOption,
  toggleTimeOption,
  votingDraftFromEvent,
  type VotingDraft,
} from "../participant-voting";
import { haptic } from "../telegram";
import type { EventData } from "../types";
import type { Navigate } from "../app-types";
import { useMainButton, useParticipantEvent } from "../app-hooks";
import { Header, Loading, ErrorNote, RetryState, StatusBadge } from "../ui/common";
import { PublicPreviewScreen } from "./PublicPreviewScreen";
import { LeaveMeetingAction } from "../ui/LeaveMeetingAction";
import { Result } from "./Result";

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

export function ParticipantEvent({
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
      void askWriteAccessOnce(() => api.notificationSettings({ writeAccessGranted: true }));
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
        <p className="create-step-label">{event.canManage ? "Ваша встреча" : "Вас приглашают"}</p>
        <h1>{event.title}</h1>
        {event.canManage && (
          <button
            className="secondary-action"
            onClick={() => navigate(managementPath(eventId))}
            type="button"
          >
            Управлять встречей
          </button>
        )}
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
