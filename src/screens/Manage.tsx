import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, MapPin, Plus, Send, Trash2, Users, XCircle } from "lucide-react";
import { api } from "../api";
import { formatSlot, plural } from "../domain";
import { managePayloads, runActionOnce } from "../manage-actions";
import { nonNegativeIntegerFromInput, normalizeNumericInput } from "../numeric-input";
import { OrganizerJoinRequests } from "../OrganizerJoinRequests";
import { haptic } from "../telegram";
import type { MeetingCategory, OrganizerParticipant } from "../types";
import type { Navigate, EditablePlaceDraft } from "../app-types";
import {
  Header,
  Loading,
  ErrorNote,
  RetryState,
  EmptyState,
  StatusBadge,
  CategoryBadge,
  CategoryChip,
  Refresh,
} from "../ui/common";
import { useEvent } from "../app-hooks";
import { SafetyActions } from "../ui/Moderation";
import { usePreparedShare, shareEvent } from "../share";
import { t } from "../i18n";

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
  const [categoryChoices, setCategoryChoices] = useState<MeetingCategory[]>([]);
  const [categoryError, setCategoryError] = useState("");
  const actionLock = useRef(false);
  useEffect(() => {
    // Optional: without the list the category simply cannot be changed here.
    let active = true;
    api.categories().then(
      ({ categories }) => { if (active) setCategoryChoices(categories); },
      (reason) => console.error("categories_load_failed", reason),
    );
    return () => { active = false; };
  }, []);
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
  // A local error kind keeps the message next to the control that failed.
  const mutate = async (payload: unknown, removalKind?: "time" | "place" | "category") => {
    if (actionLock.current) return false;
    if (removalKind === "time") setTimeRemovalError("");
    if (removalKind === "place") setPlaceRemovalError("");
    if (removalKind === "category") setCategoryError("");
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
        : t("Не удалось изменить встречу.");
      if (removalKind === "time") setTimeRemovalError(message);
      else if (removalKind === "place") setPlaceRemovalError(message);
      else if (removalKind === "category") setCategoryError(message);
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
        t("Не удалось исключить участника. Попробуйте ещё раз."),
      );
      haptic("error");
    } finally {
      setRemovingParticipantId(null);
    }
  };
  if (!state.event)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} onBack={onBack} title={t("Управление встречей")} variant="nested" />
        {state.error ? (
          <RetryState
            message={state.error}
            onRetry={() => void state.load()}
            title={t("Управление не загрузилось")}
          />
        ) : (
          <Loading />
        )}
      </main>
    );
  const event = state.event;
  const missingDecisionOptions = [
    event.timeOptions.length ? "" : t("время"),
    event.placeOptions.length ? "" : t("место"),
  ].filter(Boolean);
  const decisionHint =
    event.status === "decided"
      ? t("Итог выбран. При необходимости встречу можно возобновить.")
      : missingDecisionOptions.length
        ? t("Добавьте варианты: {options}, затем выберите итог.", { options: missingDecisionOptions.join(t(" и ")) })
        : t("Выберите итоговое время и место, когда будете готовы принять решение.");
  if (!event.canManage)
    return (
      <main className="manage-screen">
        <Header navigate={navigate} onBack={onBack} title={t("Управление встречей")} variant="nested" />
        <RetryState
          message={t("Управлять встречей может только её организатор.")}
          title={t("Нет доступа")}
        />
      </main>
    );
  return (
    <main className="manage-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Управление встречей")} variant="nested" />
      <section className="manage-intro">
        <p className="create-step-label">{t("Управление встречей")}</p>
        <h1>{event.title}</h1>
        {event.description && <p className="manage-description">{event.description}</p>}
        <div className="event-meta">
          <StatusBadge status={event.status} />
          {event.visibility === "public" && <span className="visibility-badge">{t("Открытая")}</span>}
          {event.category && <CategoryBadge category={event.category} />}
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
        {event.hiddenByModerator && (
          <p className="moderation-notice" role="status">
            {t("Администратор скрыл встречу из ленты открытых встреч: новые люди не найдут её и не смогут подать заявку. Участники по-прежнему её видят.")}</p>
        )}
        <section className="manage-next-action" aria-labelledby="manage-next-action-title">
          <div>
            <p className="manage-section-kicker">{t("Следующий шаг")}</p>
            <h2 id="manage-next-action-title">
              {event.status === "decided" ? t("Решение принято") : t("Подготовьте итог встречи")}
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
          <h2><span>{t("Описание")}</span><small>{t("Основная информация о встрече")}</small></h2>
          <label className="field">
            <span>{t("Название")}</span>
            <input
              value={title}
              onChange={(input) => setTitle(input.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("Комментарий")}</span>
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
            {t("Сохранить описание")}</button>
          {categoryChoices.length > 0 && (
            <fieldset className="category-picker">
              <legend>{t("Категория")} <span>{t("меняется сразу")}</span></legend>
              <div className="category-chips category-chips-wrap">
                {categoryChoices.map((choice) => {
                  const selected = event.category?.id === choice.id;
                  return (
                    <CategoryChip
                      category={choice}
                      disabled={saving}
                      key={choice.id}
                      onToggle={() => void mutate(managePayloads.setCategory(selected ? null : choice.id), "category")}
                      selected={selected}
                    />
                  );
                })}
              </div>
              <ErrorNote message={categoryError} />
            </fieldset>
          )}
        </section>
        <section className="panel manage-card manage-time-card">
          <h2><CalendarDays size={24} /><span>{t("Время")}<small>{t("Варианты, за которые могут голосовать участники")}</small></span></h2>
          {event.timeOptions.map((slot) => (
            <div className="slot-card" key={slot.id}>
              <div>
                <strong>{formatSlot(slot.startsAt)}</strong>
                <span>
                  {plural(slot.availableCount, "голос", "голоса", "голосов")}
                </span>
              </div>
              <button
                aria-label={t("Удалить вариант времени")}
                className="icon-action danger"
                onClick={async () => {
                  if (
                    slot.availableCount &&
                    !confirm(
                      t("За вариант проголосовали {count}. Удалить его и голоса?", { count: slot.availableCount }),
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
                title={t("Удалить время")}
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
              {t("Добавить")}</button>
          </div>
        </section>
        <ErrorNote message={timeRemovalError} />
        <section className="panel manage-card manage-places-card">
          <h2><MapPin size={24} /><span>{t("Места")}<small>{t("Варианты локации и ориентир по бюджету")}</small></span></h2>
          {!event.placeOptions.length && (
            <p className="manage-empty-options">{t("Мест пока нет. Добавьте вариант, если участникам нужно выбрать локацию.")}</p>
          )}
          {event.placeOptions.map((item) => (
            <div className="slot-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.area}  {t("· до")} {item.estimatedBudget} BYN
                </span>
              </div>
              <button
                aria-label={t("Удалить вариант места")}
                className="icon-action danger"
                onClick={() =>
                  void mutate(managePayloads.removePlace(item.id), "place")
                }
                title={t("Удалить место")}
                type="button"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          <div className="add-place">
            <input
              placeholder={t("Место")}
              value={place.title}
              onChange={(input) =>
                setPlace({ ...place, title: input.target.value })
              }
            />
            <input
              placeholder={t("Район")}
              value={place.area}
              onChange={(input) =>
                setPlace({ ...place, area: input.target.value })
              }
            />
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={t("До, BYN")}
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
              {t("Добавить")}</button>
          </div>
        </section>
        <ErrorNote message={placeRemovalError} />
        <section className="panel manage-card manage-participants-card">
          <h2><Users size={24} /><span>{t("Ответы участников")}<small>{t("Разверните строку, чтобы посмотреть ответ и действия")}</small></span></h2>
          {event.participants.length ? (
            event.participants.map((person) => (
              <details className="participant-answer" key={person.id}>
                <summary>
                  <strong>{person.name}</strong>
                  <span>{person.area || t("Район не указан")}</span>
                </summary>
                <div>
                  <p>
                    <b>{t("Могу:")}</b>{" "}
                    {event.timeOptions
                      .filter((slot) =>
                        person.availableTimeOptionIds.includes(slot.id),
                      )
                      .map((slot) => formatSlot(slot.startsAt))
                      .join(" · ") || t("нет")}
                  </p>
                  <p>
                    <b>{t("Не могу:")}</b>{" "}
                    {event.timeOptions
                      .filter((slot) =>
                        person.unavailableTimeOptionIds.includes(slot.id),
                      )
                      .map((slot) => formatSlot(slot.startsAt))
                      .join(" · ") || t("нет")}
                  </p>
                  <p>
                    <b>{t("Бюджет:")}</b> {person.budget} BYN
                  </p>
                  <p>
                    <b>{t("Предпочтения:")}</b> {person.preferences || t("нет")}
                  </p>
                  <p>
                    <b>{t("Ограничения:")}</b> {person.restrictions || t("нет")}
                  </p>
                  {event.myResponse?.id !== person.id && person.userId && (
                    <SafetyActions
                      eventId={eventId}
                      personLabel={person.name}
                      reportSubject={t("Жалоба на участника {name}", { name: person.name })}
                      target={{ kind: "participant", participantId: person.id }}
                    />
                  )}
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
                        ? t("Исключаем…")
                        : t("Исключить из встречи")}
                    </button>
                  )}
                </div>
              </details>
            ))
          ) : (
            <EmptyState
              text={t("Отправьте приглашение в чат — ответы появятся здесь.")}
              title={t("Ответов пока нет")}
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
              <h2 id="participant-remove-title">{t("Исключить участника?")}</h2>
              <p>{t("Его ответ и голоса будут удалены.")}</p>
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
                  {t("Отмена")}</button>
                <button
                  className="danger-button"
                  disabled={Boolean(removingParticipantId)}
                  onClick={() => void removeParticipant()}
                  type="button"
                >
                  {removingParticipantId ? t("Исключаем…") : t("Исключить")}
                </button>
              </div>
            </section>
          </div>
        )}
        <section className="panel manage-card decision-panel">
          <h2><Check size={24} /> <span>{t("Окончательное решение")}<small>{event.status === "decided" ? t("Итог встречи") : t("Выберите финальные варианты")}</small></span></h2>
          <p className="decision-hint">{decisionHint}</p>
          <label className="field">
            <span>{t("Время")}</span>
            <select
              value={finalTime}
              onChange={(input) => setFinalTime(input.target.value)}
            >
              <option value="">{t("Выберите время")}</option>
              {event.timeOptions.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatSlot(slot.startsAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("Место")}</span>
            <select
              value={finalPlace}
              onChange={(input) => setFinalPlace(input.target.value)}
            >
              <option value="">{t("Выберите место")}</option>
              {event.placeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.area}
                </option>
              ))}
            </select>
          </label>
          {event.status === "cancelled" && (
            <p className="settings-note">{t("Встреча отменена. Итог и сбор ответов больше недоступны.")}</p>
          )}
          <button
            className="primary-action"
            disabled={!finalTime || !finalPlace || saving || event.status === "cancelled"}
            onClick={() =>
              void mutate(managePayloads.decide(finalTime, finalPlace))
            }
            type="button"
          >
            {t("Принять решение")}</button>
          {event.status === "collecting" && (
            <button
              className="secondary-action"
              onClick={() => void mutate(managePayloads.close())}
              type="button"
            >
              {t("Закрыть сбор ответов")}</button>
          )}
          {event.status !== "collecting" && event.status !== "cancelled" && (
            <button
              className="secondary-action"
              onClick={() => void mutate(managePayloads.reopen())}
              type="button"
            >
              {t("Возобновить сбор ответов")}</button>
          )}
        </section>
        <div className="action-row manage-actions">
          <div className="manage-secondary-actions">
            <p className="manage-section-kicker">{t("Дополнительно")}</p>
            <button
              className="secondary-action"
              onClick={() => shareEvent(event.id, invitePrepared)}
              type="button"
            >
              <Send size={18} />
              {t("Отправить в чат")}</button>
            <button
              className="secondary-action"
              onClick={() => navigate(`/result/${event.id}`)}
              type="button"
            >
              {t("Открыть результат")}</button>
          </div>
          {event.status !== "cancelled" && (
            <div className="manage-secondary-actions">
              <p className="manage-section-kicker">{t("Отмена")}</p>
              <p>{t("Встреча останется в истории, участники получат уведомление.")}</p>
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => {
                  if (confirm(t("Отменить встречу? Участники получат уведомление.")))
                    void mutate(managePayloads.cancel());
                }}
                type="button"
              >
                <XCircle size={18} />
                {t("Отменить встречу")}</button>
            </div>
          )}
          <div className="manage-danger-zone">
            <p className="manage-section-kicker">{t("Удаление")}</p>
            <p>{t("Удаление встречи необратимо для всех участников.")}</p>
            <button
              className="danger-button"
              onClick={async () => {
                if (confirm(t("Удалить встречу?"))) {
                  const removed = await runActionOnce(actionLock, () =>
                    api.remove(event.id),
                  );
                  if (removed) navigate("/my-events", true);
                }
              }}
              type="button"
            >
              <Trash2 size={18} />
              {t("Удалить встречу")}</button>
          </div>
        </div>
        <ErrorNote message={state.error} />
      </section>
    </main>
  );
}
