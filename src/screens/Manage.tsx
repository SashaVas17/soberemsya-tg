import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, MapPin, Plus, Send, Trash2, Users, XCircle } from "lucide-react";
import { api } from "../api";
import { formatSlot, plural } from "../domain";
import { managePayloads, runActionOnce } from "../manage-actions";
import { nonNegativeIntegerFromInput, normalizeNumericInput } from "../numeric-input";
import { OrganizerJoinRequests } from "../OrganizerJoinRequests";
import { haptic } from "../telegram";
import type { OrganizerParticipant } from "../types";
import type { Navigate, EditablePlaceDraft } from "../app-types";
import {
  Header,
  Loading,
  ErrorNote,
  RetryState,
  EmptyState,
  StatusBadge,
  Refresh,
} from "../ui/common";
import { useEvent } from "../app-hooks";
import { usePreparedShare, shareEvent } from "../share";

export function Manage({
  eventId,
  navigate,
  onBack,
}: {
  eventId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const state = useEvent(eventId);
  const invitePrepared = usePreparedShare(eventId, "invite");
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
          {event.status === "cancelled" && (
            <p className="settings-note">Встреча отменена. Итог и сбор ответов больше недоступны.</p>
          )}
          <button
            className="primary-action"
            disabled={!finalTime || !finalPlace || saving || event.status === "cancelled"}
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
          {event.status !== "collecting" && event.status !== "cancelled" && (
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
              onClick={() => shareEvent(event.id, invitePrepared)}
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
          {event.status !== "cancelled" && (
            <div className="manage-secondary-actions">
              <p className="manage-section-kicker">Отмена</p>
              <p>Встреча останется в истории, участники получат уведомление.</p>
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => {
                  if (confirm("Отменить встречу? Участники получат уведомление."))
                    void mutate(managePayloads.cancel());
                }}
                type="button"
              >
                <XCircle size={18} />
                Отменить встречу
              </button>
            </div>
          )}
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
