import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock3, MapPin, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { askWriteAccessOnce } from "../write-access";
import {
  advanceCreateStep,
  addTimeOption,
  createdEventPath,
  createTimeOption,
  previousCreateStep,
  removeTimeOption,
  createEventErrorMessage,
  submitCreateEventOnce,
  validateCreateStep,
  type CreateWizardDraft,
  type MeetingVisibility,
} from "../create-wizard";
import {
  nonNegativeIntegerFromInput,
  normalizeNumericInput,
  requiredNonNegativeIntegerFromInput,
} from "../numeric-input";
import { haptic } from "../telegram";
import type { EventData, MeetingCategory } from "../types";
import type { Navigate, EditablePlaceDraft, CreatedGroup } from "../app-types";
import { CategoryChip, Header, ErrorNote } from "../ui/common";
import { VenuePicker } from "../ui/Venues";
import { clearVenueForNextMeeting, venueForNextMeeting, venuePlaceDraft } from "../venues";
import { t } from "../i18n";

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
      setPickerError(t("Выберите корректные дату и время."));
      return;
    }
    if (slots.includes(option)) {
      setPickerError(t("Этот вариант уже добавлен."));
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
                <span>{t("Дата")}</span>
                <input
                  min={defaultDate}
                  onChange={(event) => change(slot, event.target.value, values.time)}
                  type="date"
                  value={values.date}
                />
              </label>
              <label className="field">
                <span>{t("Время")}</span>
                <input
                  onChange={(event) => change(slot, values.date, event.target.value)}
                  type="time"
                  value={values.time}
                />
              </label>
              {slots.length > 1 && (
                <button
                  aria-label={t("Удалить вариант")}
                  className="icon-action danger"
                  onClick={() => onChange(removeTimeOption(slots, slot))}
                  title={t("Удалить вариант")}
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
        {t("Добавить время")}</button>
      {pickerOpen && (
        <div className="time-picker-backdrop" role="presentation">
          <section
            aria-labelledby="time-picker-title"
            aria-modal="true"
            className="time-picker-dialog"
            role="dialog"
          >
            <div className="section-row">
              <h2 id="time-picker-title">{t("Новый вариант времени")}</h2>
              <button
                aria-label={t("Закрыть выбор времени")}
                className="icon-action"
                onClick={() => setPickerOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="field">
              <span>{t("Дата")}</span>
              <input
                min={defaultDate}
                onChange={(event) => setPickerDate(event.target.value)}
                type="date"
                value={pickerDate}
              />
            </label>
            <label className="field">
              <span>{t("Время")}</span>
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
                {t("Отмена")}</button>
              <button
                className="primary-action"
                onClick={confirmPicker}
                type="button"
              >
                {t("Добавить")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function CreateEvent({
  navigate,
  onBack,
  setBackOverride,
  onCreated,
  groupToken,
}: {
  navigate: Navigate;
  onBack: () => void;
  setBackOverride: (value: (() => void) | null) => void;
  onCreated: (event: EventData, group?: CreatedGroup) => void;
  groupToken: string | null;
}) {
  const [step, setStep] = useState(1);
  const [groupTitle, setGroupTitle] = useState<string | null>(null);
  const [groupError, setGroupError] = useState("");
  useEffect(() => {
    setGroupTitle(null);
    setGroupError("");
    if (!groupToken) return;
    let active = true;
    api.groupLink(groupToken)
      .then(({ groupLink }) => { if (active) setGroupTitle(groupLink.chatTitle); })
      .catch((reason) => {
        if (active)
          setGroupError(reason instanceof Error ? reason.message : t("Не удалось открыть ссылку из группы."));
      });
    return () => { active = false; };
  }, [groupToken]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetLimitInput, setBudgetLimitInput] = useState("30");
  const [visibility, setVisibility] = useState<MeetingVisibility>("private");
  // «Создать встречу» on a venue card starts the wizard with that venue as
  // the first place option and its category chosen.
  const [startVenue] = useState(venueForNextMeeting);
  useEffect(() => clearVenueForNextMeeting(), []);
  const [category, setCategory] = useState<string | null>(startVenue?.categoryId ?? null);
  const [categoryChoices, setCategoryChoices] = useState<MeetingCategory[]>([]);
  useEffect(() => {
    // Optional: without the list the meeting is simply created without a category.
    let active = true;
    api.categories().then(
      ({ categories }) => { if (active) setCategoryChoices(categories); },
      (reason) => console.error("categories_load_failed", reason),
    );
    return () => { active = false; };
  }, []);
  const [hasParticipantLimit, setHasParticipantLimit] = useState(false);
  const [maxParticipantsInput, setMaxParticipantsInput] = useState("6");
  const [timeOptions, setTimeOptions] = useState<string[]>([]);
  // An edited name or address is no longer the catalogue venue: its link
  // (which puts an open meeting on the map) is dropped.
  const [places, setPlaces] = useState<EditablePlaceDraft[]>(() =>
    startVenue ? [venuePlaceDraft(startVenue, budgetLimitInput)] : [],
  );
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
    category,
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
    let result: Awaited<ReturnType<typeof api.createEvent>> | null;
    try {
      result = await submitCreateEventOnce(draft, submitLock, (payload) =>
        api.createEvent(groupToken ? { ...payload, groupToken } : payload));
    } catch (reason) {
      haptic("error");
      setError(createEventErrorMessage(reason));
      return;
    } finally {
      setSaving(false);
    }
    if (!result) return;
    haptic();
    onCreated(
      result.event,
      groupToken ? { chatTitle: groupTitle ?? "", attached: result.groupAttached === true } : undefined,
    );
    void askWriteAccessOnce(() => api.notificationSettings({ writeAccessGranted: true }));
    navigate(createdEventPath(result.event.id), true);
  }, [budgetLimit, category, description, groupTitle, groupToken, hasParticipantLimit, maxParticipants, maxParticipantsInput, navigate, onCreated, places, saving, timeOptions, title, visibility]);
  return (
    <main className="create-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Создание встречи")} variant="nested" />
      <section className="create-intro">
        {groupTitle !== null && (
          <p className="group-create-note">
            {t("Встреча для чата «")}{groupTitle}{t("». После создания карточка для голосования появится в чате.")}</p>
        )}
        {groupError && <p className="group-create-note group-create-note-error">{groupError}</p>}
        <p className="create-step-label">{t("Шаг")} {step}  {t("из 3")}</p>
        <h1>{step === 1 ? t("Что планируем?") : step === 2 ? t("Когда встречаемся?") : t("Где и сколько?")}</h1>
        {step === 2 && (
          <p className="create-step-description">
            {t("Добавьте несколько вариантов дат, чтобы участники могли выбрать удобное время.")}</p>
        )}
        <div className="step-progress" aria-label={t("Шаг {step} из 3", { step })}>
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
            <span>{t("Название встречи")}</span>
            <input
              autoFocus
              placeholder={t("Например, шашлыки с друзьями")}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("Описание (необязательно)")}</span>
            <textarea
              placeholder={t("Добавьте детали, чтобы все были в курсе…")}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {categoryChoices.length > 0 && (
            <fieldset className="category-picker">
              <legend>{t("Категория")} <span>{t("необязательно")}</span></legend>
              <div className="category-chips category-chips-wrap">
                {categoryChoices.map((choice) => (
                  <CategoryChip
                    category={choice}
                    key={choice.id}
                    onToggle={() => setCategory(category === choice.id ? null : choice.id)}
                    selected={category === choice.id}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="visibility-selector">
            <legend>{t("Кто сможет присоединиться?")}</legend>
            <button
              aria-pressed={visibility === "private"}
              className={`visibility-option${visibility === "private" ? " selected" : ""}`}
              onClick={() => {
                setVisibility("private");
                setHasParticipantLimit(false);
              }}
              type="button"
            >
              <span className="visibility-option-title"><strong>{t("По приглашению")}</strong><span className="visibility-option-mark" aria-hidden="true">{visibility === "private" && <Check size={16} />}</span></span>
              <span>{t("Встречу увидят только те, кому вы отправите ссылку")}</span>
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
              <span className="visibility-option-title"><strong>{t("Открытая встреча")}</strong><span className="visibility-option-mark" aria-hidden="true">{visibility === "public" && <Check size={16} />}</span></span>
              <span>{t("Пользователи Flockly смогут найти встречу и отправить заявку")}</span>
            </button>
          </fieldset>
          {visibility === "public" && (
            <fieldset className="capacity-selector">
              <legend>{t("Сколько человек может быть на встрече?")}</legend>
              <p>{t("Всего людей, включая вас")}</p>
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
                <span>{t("Ограничить")}</span>
                <input
                  aria-label={t("Лимит участников")}
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
                <span>{t("Без ограничения")}</span>
              </label>
            </fieldset>
          )}
        </section>}
        {step === 2 && <section className="wizard-time-panel">
          <div className="section-row create-section-heading">
            <div>
              <h2>{t("Варианты времени")}</h2>
              <p>{t("Добавьте хотя бы один вариант, чтобы участники могли выбрать удобное время.")}</p>
            </div>
            <Clock3 aria-hidden="true" size={24} />
          </div>
          {!hasValidTimeOption && (
            <p className="create-inline-hint" role="status">
              {t("Добавьте хотя бы один вариант даты и времени, чтобы продолжить.")}</p>
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
              <h2>{t("Места")}</h2>
              <p className="create-section-helper">{t("Места необязательны. Выберите из подборки или добавьте своё, если участникам нужно выбрать локацию.")}</p>
            </div>
            <MapPin aria-hidden="true" size={24} />
          </div>
          {!places.length && (
            <p className="create-empty-options">{t("Пока нет добавленных мест.")}</p>
          )}
          {places.map((place, index) => (
            <div className="place-draft" key={index}>
              <label className="field">
                <span>{t("Место")}</span>
                <input
                  placeholder={t("Название места")}
                  value={place.title}
                  onChange={(event) =>
                    setPlaces(
                      places.map((item, i) =>
                        i === index
                          ? { ...item, title: event.target.value, venueId: undefined }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>{t("Район или метро")}</span>
                <input
                  placeholder={t("Район, метро или ориентир")}
                  value={place.area}
                  onChange={(event) =>
                    setPlaces(
                      places.map((item, i) =>
                        i === index
                          ? { ...item, area: event.target.value, venueId: undefined }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>{t("Бюджет этого места, BYN")}</span>
                <input
                  min="0"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={t("Например, 30")}
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
                  title={t("Удалить место")}
                  type="button"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
          <VenuePicker
            budget={budgetLimit}
            categories={categoryChoices}
            initialCategoryId={category}
            onPick={(venue) => setPlaces((current) => [...current, venuePlaceDraft(venue, budgetLimitInput)])}
            places={places}
          />
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
            {t("Добавить место")}</button>
          <label className="field budget-field">
            <span>{t("Общий бюджет встречи, BYN")}</span>
            <small>{t("Общий ориентир для всей встречи. Бюджет места выше задаётся отдельно.")}</small>
            <input
              inputMode="numeric"
              onChange={(event) =>
                setBudgetLimitInput(normalizeNumericInput(event.target.value))
              }
              pattern="[0-9]*"
              placeholder={t("Например, 30")}
              type="text"
              value={budgetLimitInput}
            />
          </label>
        </section>}
        <ErrorNote message={error} />
        <div className={`wizard-actions${step === 2 ? " step-2-actions" : ""}`}>
          {step === 3 && (
            <button className="secondary-action" disabled={saving} onClick={() => { setError(""); setStep((current) => previousCreateStep(current)); }} type="button">
              {t("Назад")}</button>
          )}
          <button
            className="primary-action"
            disabled={saving || (step === 2 && !hasValidTimeOption)}
            type="submit"
          >
            {step < 3 ? t("Продолжить") : saving ? t("Создаём…") : t("Создать встречу")}
          </button>
        </div>
      </form>
    </main>
  );
}
