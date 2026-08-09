import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import { areaLeaders, bestSlot, buildGoogleCalendarUrl, formatDateRange, formatSlot, plural } from "./domain";
import { haptic, initializeTelegram, openExternalUrl, openTelegramUrl, telegram, telegramPlatform } from "./telegram";
import type { AuthResult, EventData, EventStatus, MeetingListItem, PlaceOption } from "./types";

type Navigate = (path: string, replace?: boolean) => void;
type PlaceDraft = { title: string; area: string; estimatedBudget: number };
type Meetings = { owned: MeetingListItem[]; participating: MeetingListItem[] };

const statusLabels: Record<EventStatus, string> = {
  collecting: "Сбор ответов",
  place_selection: "Сбор закрыт",
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
    if (replace) window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${target}`);
    else window.location.hash = next;
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  return { path, navigate };
}

function useTelegramBack(path: string, navigate: Navigate, override: (() => void) | null) {
  useEffect(() => {
    const button = telegram()?.BackButton;
    if (!button) return;
    const back = () => {
      if (override) return override();
      if (window.history.length > 1) window.history.back();
      else navigate("/", true);
    };
    if (path === "/") button.hide();
    else {
      button.show();
      button.onClick(back);
    }
    return () => button.offClick(back);
  }, [navigate, override, path]);
}

function Header({ navigate, createShortcut = false }: { navigate: Navigate; createShortcut?: boolean }) {
  return <header className="topbar">
    <button className="wordmark" onClick={() => navigate("/")} type="button">Соберёмся</button>
    {createShortcut && <button className="icon-action" onClick={() => navigate("/create")} title="Создать встречу" type="button"><Plus size={21} /></button>}
  </header>;
}

function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`status-badge ${status}`}>{statusLabels[status]}</span>;
}

function PageIntro({ eyebrow, title, children, compact = false }: { eyebrow?: string; title: string; children?: React.ReactNode; compact?: boolean }) {
  return <section className={`page-intro ${compact ? "compact" : ""}`}>
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>
    {children}
  </section>;
}

function Loading({ label = "Загружаем…" }: { label?: string }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

function RetryState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="not-found"><strong>{message}</strong>{onRetry && <button className="secondary-action" onClick={onRetry} type="button">Повторить</button>}</div>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><span>{text}</span>{action}</div>;
}

function Refresh({ refreshing, lastUpdated, onClick }: { refreshing: boolean; lastUpdated: Date | null; onClick: () => void }) {
  return <div className="refresh"><button className="icon-text-action" disabled={refreshing} onClick={onClick} type="button"><RefreshCw className={refreshing ? "spin" : ""} size={16} />{refreshing ? "Обновляем…" : "Обновить"}</button>{lastUpdated && <span>Обновлено {lastUpdated.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>}</div>;
}

function MeetingCard({ item, navigate }: { item: MeetingListItem; navigate: Navigate }) {
  const destination = item.role === "owner" ? `/manage/${item.id}` : `/event/${item.id}`;
  const fallbackTime = item.bestTime ? formatSlot(item.bestTime.startsAt) : null;
  const time = item.timeSummary ?? fallbackTime;
  return <button className="meeting-card" onClick={() => navigate(destination)} type="button">
    <div className="meeting-card-main"><StatusBadge status={item.status} /><strong>{item.title}</strong>{time && <span className="meeting-summary"><Clock3 size={15} />{time}</span>}{item.placeSummary && <span className="meeting-summary"><MapPin size={15} />{item.placeSummary}</span>}<span>{plural(item.responseCount ?? item.participantCount, "ответ", "ответа", "ответов")}</span></div><ChevronRight size={20} />
  </button>;
}

function MeetingGroup({ title, items, navigate, empty }: { title: string; items: MeetingListItem[]; navigate: Navigate; empty: React.ReactNode }) {
  return <section className="meeting-group"><h2>{title}</h2>{items.length ? items.map((item) => <MeetingCard key={item.id} item={item} navigate={navigate} />) : empty}</section>;
}

function Home({ navigate, user }: { navigate: Navigate; user: AuthResult["user"] }) {
  const [data, setData] = useState<Meetings | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => api.meetings().then(setData).then(() => setError(false)).catch(() => setError(true)), []);
  useEffect(() => { void load(); }, [load]);
  const active = data?.owned.filter((item) => item.status === "collecting").length ?? 0;
  const waiting = data?.participating.filter((item) => item.status === "collecting").length ?? 0;
  const isNew = data && !data.owned.length && !data.participating.length;
  return <main><Header navigate={navigate} createShortcut />
    <section className="home-hero"><div><p className="eyebrow">Добрый день, {user.firstName}</p><h1>Соберёмся</h1><p className="lead">Быстро выберите время и место для встречи прямо в Telegram.</p><button className="primary-action" onClick={() => navigate("/create")} type="button"><Plus size={19} />Создать встречу</button><button className="text-action" onClick={() => navigate("/my-events")} type="button">Мои встречи <ChevronRight size={16} /></button></div>
      {data && <div className="home-summary">{isNew ? <><span>Внутри Telegram</span><strong>Без регистрации и паролей</strong><p>Создайте встречу, отправьте ссылку в чат и соберите ответы.</p></> : <><span>Сейчас</span><strong>{plural(active, "активная встреча", "активные встречи", "активных встреч")}</strong><p>Ждут вашего ответа: {waiting}</p></>}</div>}
    </section>
    {!data && !error && <Loading />}{error && <RetryState message="Не удалось загрузить встречи." onRetry={() => void load()} />}
    {data && <section className="dashboard-band"><MeetingGroup title="Ваши встречи" items={data.owned.slice(0, 3)} navigate={navigate} empty={<EmptyState title="У вас пока нет встреч" text="Создайте первую встречу и пригласите друзей." action={<button className="secondary-action" onClick={() => navigate("/create")} type="button">Создать первую встречу</button>} />} /><MeetingGroup title="Вы участвуете" items={data.participating.slice(0, 3)} navigate={navigate} empty={<EmptyState title="Пока нет приглашений" text="Здесь появятся встречи, на которые вас пригласили." />} /></section>}
  </main>;
}

function SlotBuilder({ slots, onChange }: { slots: string[]; onChange: (next: string[]) => void }) {
  const today = new Date();
  const [date, setDate] = useState(today.toISOString().slice(0, 10));
  const [time, setTime] = useState("18:30");
  const add = () => { const value = new Date(`${date}T${time}:00`).toISOString(); if (!slots.includes(value)) onChange([...slots, value].sort()); };
  return <div className="slot-builder"><div className="slot-controls"><label className="field"><span>Дата</span><input min={today.toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label><label className="field"><span>Время</span><input onChange={(event) => setTime(event.target.value)} type="time" value={time} /></label><button className="secondary-action" onClick={add} type="button"><Plus size={18} />Добавить время</button></div><div className="slot-list">{slots.map((slot) => <div className="slot-card" key={slot}><strong>{formatSlot(slot)}</strong><button className="icon-action danger" onClick={() => onChange(slots.filter((value) => value !== slot))} title="Удалить вариант" type="button"><Trash2 size={18} /></button></div>)}</div></div>;
}

function PlaceEditor({ places, onChange, budgetLimit }: { places: PlaceDraft[]; onChange: (places: PlaceDraft[]) => void; budgetLimit: number }) {
  const update = (index: number, patch: Partial<PlaceDraft>) => onChange(places.map((place, i) => i === index ? { ...place, ...patch } : place));
  return <div className="place-editor">{places.map((place, index) => <div className="place-draft" key={index}><label className="field"><span>Место</span><input value={place.title} onChange={(event) => update(index, { title: event.target.value })} /></label><label className="field"><span>Район или метро</span><input value={place.area} onChange={(event) => update(index, { area: event.target.value })} /></label><label className="field"><span>До, BYN</span><input min="0" type="number" value={place.estimatedBudget} onChange={(event) => update(index, { estimatedBudget: Number(event.target.value) })} /></label>{places.length > 1 && <button className="icon-action danger" onClick={() => onChange(places.filter((_, i) => i !== index))} title="Удалить место" type="button"><Trash2 size={18} /></button>}</div>)}<button className="secondary-action" onClick={() => onChange([...places, { title: "", area: "", estimatedBudget: budgetLimit }])} type="button"><Plus size={18} />Добавить место</button></div>;
}

function CreateEvent({ navigate, setBackOverride }: { navigate: Navigate; setBackOverride: (value: (() => void) | null) => void }) {
  const [step, setStep] = useState(1); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [budgetLimit, setBudgetLimit] = useState(30); const [timeOptions, setTimeOptions] = useState<string[]>([]); const [places, setPlaces] = useState<PlaceDraft[]>([{ title: "", area: "", estimatedBudget: 30 }]); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setBackOverride(() => () => step > 1 ? setStep((current) => current - 1) : navigate("/")); return () => setBackOverride(null); }, [navigate, setBackOverride, step]);
  const next = () => { if (step === 1 && !title.trim()) return setError("Введите название встречи."); if (step === 2 && !timeOptions.length) return setError("Добавьте хотя бы один вариант времени."); setError(""); setStep((current) => current + 1); };
  const submit = async () => { if (saving) return; setSaving(true); setError(""); try { const { event } = await api.createEvent({ title, description, budgetLimit, timeOptions, placeOptions: places.filter((place) => place.title.trim()) }); haptic(); navigate(`/created/${event.id}`, true); } catch (reason) { haptic("error"); setError(reason instanceof Error ? reason.message : "Не удалось создать встречу."); } finally { setSaving(false); } };
  return <main><Header navigate={navigate} /><PageIntro eyebrow={`Шаг ${step}/3`} title={step === 1 ? "О встрече" : step === 2 ? "Когда встречаемся?" : "Где встречаемся?"} compact><p>{step === 1 ? "Расскажите, что планируете." : step === 2 ? "Добавьте несколько удобных вариантов." : "Места можно добавить сейчас или позже."}</p></PageIntro><section className="form-page wizard"><div className="progress"><span style={{ width: `${step / 3 * 100}%` }} /></div>{step === 1 && <section className="panel"><label className="field"><span>Название *</span><textarea autoFocus required rows={2} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Комментарий</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field narrow"><span>Бюджет, BYN</span><input min="0" type="number" value={budgetLimit} onChange={(event) => setBudgetLimit(Number(event.target.value))} /></label></section>}{step === 2 && <section className="panel"><SlotBuilder slots={timeOptions} onChange={setTimeOptions} /></section>}{step === 3 && <section className="panel"><PlaceEditor places={places} onChange={setPlaces} budgetLimit={budgetLimit} /></section>}{error && <p className="form-error">{error}</p>}<div className="sticky-actions">{step > 1 && <button className="secondary-action" onClick={() => setStep(step - 1)} type="button">Назад</button>}{step < 3 ? <button className="primary-action" onClick={next} type="button">Далее <ChevronRight size={18} /></button> : <button className="primary-action" disabled={saving} onClick={() => void submit()} type="button">{saving ? "Создаём…" : "Создать встречу"}</button>}</div></section></main>;
}

function useEvent(eventId: string) {
  const [event, setEvent] = useState<EventData | null>(null); const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false); const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const load = useCallback(async () => { setRefreshing(true); try { const result = await api.event(eventId); setEvent(result.event); setError(""); setLastUpdated(new Date()); } catch { setError("Не удалось загрузить встречу. Попробуйте ещё раз."); } finally { setRefreshing(false); } }, [eventId]);
  useEffect(() => { void load(); }, [load]); return { event, setEvent, error, setError, refreshing, lastUpdated, load };
}

function Created({ eventId, navigate }: { eventId: string; navigate: Navigate }) {
  const [copied, setCopied] = useState(false); const link = miniAppLink(eventId);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { prompt("Скопируйте ссылку", link); } };
  return <main><Header navigate={navigate} /><PageIntro eyebrow="Встреча создана" title="Можно приглашать"><p>Встреча сохранена в разделе «Мои встречи».</p></PageIntro><section className="confirmation-panel"><button className="primary-action" onClick={() => shareEvent(eventId)} type="button"><Send size={19} />Отправить в чат</button><button className="secondary-action" onClick={() => void copy()} type="button"><Clipboard size={18} />{copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button><button className="secondary-action" onClick={() => navigate(`/manage/${eventId}`)} type="button">Открыть управление</button></section></main>;
}

function SelectablePlace({ place, selected, onToggle }: { place: PlaceOption; selected: boolean; onToggle: () => void }) {
  return <button className={`availability-card ${selected ? "available" : ""}`} onClick={onToggle} type="button"><strong>{place.title}</strong><span>{place.area || "Район не указан"}{place.estimatedBudget ? ` · до ${place.estimatedBudget} BYN` : ""}{selected && <><Check size={16} />Подходит</>}</span></button>;
}

function ParticipantEvent({ eventId, navigate }: { eventId: string; navigate: Navigate }) {
  const state = useEvent(eventId); const [area, setArea] = useState(""); const [budget, setBudget] = useState(30); const [preferences, setPreferences] = useState(""); const [restrictions, setRestrictions] = useState(""); const [available, setAvailable] = useState<string[]>([]); const [places, setPlaces] = useState<string[]>([]); const [saved, setSaved] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { const own = state.event?.myResponse; if (!state.event) return; setArea(own?.area ?? ""); setBudget(own?.budget ?? state.event.budgetLimit); setPreferences(own?.preferences ?? ""); setRestrictions(own?.restrictions ?? ""); setAvailable(own?.availableTimeOptionIds ?? state.event.timeOptions.map((item) => item.id)); setPlaces(own?.selectedPlaceOptionIds ?? []); }, [state.event?.id]);
  const submit = async () => { if (!state.event || saving) return; setSaving(true); try { const result = await api.saveResponse(eventId, { area, budget, preferences, restrictions, availableTimeOptionIds: available, placeOptionIds: places }); state.setEvent(result.event); setSaved(true); haptic(); } catch { state.setError("Не удалось сохранить ответ. Попробуйте ещё раз."); haptic("error"); } finally { setSaving(false); } };
  if (!state.event) return <main><Header navigate={navigate} />{state.error ? <RetryState message={state.error} onRetry={() => void state.load()} /> : <Loading label="Загружаем встречу…" />}</main>;
  const event = state.event; if (event.status !== "collecting") return <Result eventId={eventId} navigate={navigate} initial={event} />;
  if (saved) return <main><Header navigate={navigate} /><PageIntro eyebrow="Ваш ответ сохранён" title="Спасибо"><p>{bestSlot(event) ? `Сейчас лидирует ${formatSlot(bestSlot(event)!.startsAt)}.` : "Результаты появятся после ответов."}</p></PageIntro><section className="confirmation-panel"><button className="primary-action" onClick={() => setSaved(false)} type="button">Изменить мой ответ</button><button className="secondary-action" onClick={() => navigate(`/result/${eventId}`)} type="button">Посмотреть рекомендацию</button></section></main>;
  return <main><Header navigate={navigate} /><PageIntro eyebrow="Встреча" title={event.title} compact><p>{event.description}</p><div className="event-meta"><StatusBadge status={event.status} /><span>{plural(event.participants.length, "ответ", "ответа", "ответов")}</span></div></PageIntro><section className="form-page participant-form"><section className="panel"><h2>Когда вы можете?</h2><div className="availability-grid">{event.timeOptions.map((slot) => { const can = available.includes(slot.id); return <button className={`availability-card ${can ? "available" : ""}`} key={slot.id} onClick={() => setAvailable(can ? available.filter((id) => id !== slot.id) : [...available, slot.id])} type="button"><strong>{formatSlot(slot.startsAt)}</strong><span>{can ? <><Check size={17} />Могу</> : "Не могу"}</span></button>; })}</div></section>{event.placeVotingEnabled && event.placeOptions.length > 0 && <section className="panel"><h2>Какие места подходят?</h2><div className="availability-grid">{event.placeOptions.map((place) => <SelectablePlace key={place.id} place={place} selected={places.includes(place.id)} onToggle={() => setPlaces(places.includes(place.id) ? places.filter((id) => id !== place.id) : [...places, place.id])} />)}</div></section>}<section className="panel"><h2>Ваши пожелания</h2><label className="field"><span>Район или метро</span><input value={area} onChange={(input) => setArea(input.target.value)} /></label><label className="field"><span>Бюджет, BYN</span><input min="0" type="number" value={budget} onChange={(input) => setBudget(Number(input.target.value))} /></label><label className="field"><span>Предпочтения</span><textarea rows={2} value={preferences} onChange={(input) => setPreferences(input.target.value)} /></label><label className="field"><span>Ограничения</span><textarea rows={2} value={restrictions} onChange={(input) => setRestrictions(input.target.value)} /></label></section>{state.error && <p className="form-error">{state.error}</p>}<div className="sticky-actions"><button className="primary-action" disabled={saving} onClick={() => void submit()} type="button">{saving ? "Сохраняем…" : event.myResponse ? "Обновить ответ" : "Отправить ответ"}</button></div></section></main>;
}

function MyEvents({ navigate }: { navigate: Navigate }) {
  const [data, setData] = useState<Meetings | null>(null); const [error, setError] = useState(false); const load = useCallback(() => api.meetings().then(setData).then(() => setError(false)).catch(() => setError(true)), []); useEffect(() => { void load(); }, [load]);
  return <main><Header navigate={navigate} createShortcut /><PageIntro eyebrow="Telegram" title="Мои встречи" compact />{!data && !error && <Loading />}{error && <RetryState message="Не удалось загрузить встречи." onRetry={() => void load()} />}{data && <section className="my-events"><MeetingGroup title="Организую" items={data.owned} navigate={navigate} empty={<EmptyState title="У вас пока нет встреч" text="Организуйте первую встречу за минуту." action={<button className="secondary-action" onClick={() => navigate("/create")} type="button">Создать встречу</button>} />} /><MeetingGroup title="Участвую" items={data.participating} navigate={navigate} empty={<EmptyState title="Пока нет приглашений" text="Здесь появятся встречи, на которые вас пригласили." />} /></section>}</main>;
}

function VoteBar({ label, count, max, leader }: { label: string; count: number; max: number; leader: boolean }) { return <div className={`vote-bar ${leader ? "leader" : ""}`}><div><strong>{label}</strong><span>{plural(count, "голос", "голоса", "голосов")}</span></div><i><b style={{ width: `${max ? count / max * 100 : 0}%` }} /></i></div>; }

function Manage({ eventId, navigate }: { eventId: string; navigate: Navigate }) {
  const state = useEvent(eventId); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [newTime, setNewTime] = useState(""); const [place, setPlace] = useState<PlaceDraft>({ title: "", area: "", estimatedBudget: 30 }); const [finalTime, setFinalTime] = useState(""); const [finalPlace, setFinalPlace] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!state.event) return; setTitle(state.event.title); setDescription(state.event.description); setFinalTime(state.event.finalTimeOptionId ?? ""); setFinalPlace(state.event.finalPlaceId ?? ""); }, [state.event?.id, state.event?.finalPlaceId, state.event?.finalTimeOptionId]);
  const mutate = async (payload: unknown) => { setSaving(true); try { const result = await api.manage(eventId, payload); state.setEvent(result.event); haptic(); return true; } catch { state.setError("Не удалось изменить встречу. Попробуйте ещё раз."); haptic("error"); return false; } finally { setSaving(false); } };
  if (!state.event) return <main><Header navigate={navigate} />{state.error ? <RetryState message={state.error} onRetry={() => void state.load()} /> : <Loading />}</main>; const event = state.event;
  if (!event.canManage) return <main><Header navigate={navigate} /><RetryState message="У вас нет доступа к управлению этой встречей." /></main>;
  const best = bestSlot(event); const maxTime = Math.max(0, ...event.timeOptions.map((item) => item.availableCount)); const maxPlace = Math.max(0, ...event.placeOptions.map((item) => item.placeVoteCount ?? 0)); const areas = areaLeaders(event);
  return <main><Header navigate={navigate} /><PageIntro eyebrow="Управление" title={event.title} compact><div className="manage-summary"><StatusBadge status={event.status} /><span>{plural(event.participants.length, "ответ", "ответа", "ответов")}</span><span>{formatDateRange(event.timeOptions) ?? "Время не выбрано"}</span><span>{plural(event.placeOptions.length, "место", "места", "мест")}</span></div></PageIntro><section className="manage-page"><Refresh refreshing={state.refreshing} lastUpdated={state.lastUpdated} onClick={() => void state.load()} />
    <section className="panel result-overview"><h2>По голосованию</h2>{event.timeOptions.length ? <><h3>Когда</h3>{event.timeOptions.map((item) => <VoteBar key={item.id} label={formatSlot(item.startsAt)} count={item.availableCount} max={maxTime} leader={item.availableCount > 0 && item.availableCount === maxTime} />)}</> : <EmptyState title="Нет вариантов времени" text="Добавьте хотя бы один вариант." />}{event.placeVotingEnabled && event.placeOptions.length > 0 && <><h3>Где</h3>{event.placeOptions.map((item) => <VoteBar key={item.id} label={item.title} count={item.placeVoteCount ?? 0} max={maxPlace} leader={(item.placeVoteCount ?? 0) > 0 && item.placeVoteCount === maxPlace} />)}</>}{areas.length > 0 && <p className="area-summary">{areas.length > 1 ? "Нет единого района: " : "Лидирующий район: "}{areas.map(([area, count]) => `${area} (${count})`).join(", ")}</p>}</section>
    <section className="panel"><h2>Описание</h2><label className="field"><span>Название</span><input value={title} onChange={(input) => setTitle(input.target.value)} /></label><label className="field"><span>Комментарий</span><textarea rows={3} value={description} onChange={(input) => setDescription(input.target.value)} /></label><button className="secondary-action" disabled={saving} onClick={() => void mutate({ action: "update_details", title, description })} type="button">Сохранить</button></section>
    <section className="panel"><h2>Время</h2>{event.timeOptions.map((slot) => <div className="slot-card" key={slot.id}><div><strong>{formatSlot(slot.startsAt)}</strong><span>{plural(slot.availableCount, "голос", "голоса", "голосов")}</span></div><button className="icon-action danger" onClick={async () => { if (!slot.availableCount || confirm(`За этот вариант проголосовали ${slot.availableCount}. Удалить?`)) await mutate({ action: "remove_time", timeOptionId: slot.id, force: slot.availableCount > 0 }); }} title="Удалить время" type="button"><Trash2 size={18} /></button></div>)}<div className="inline-add"><input type="datetime-local" value={newTime} onChange={(input) => setNewTime(input.target.value)} /><button className="secondary-action" disabled={!newTime} onClick={async () => { if (await mutate({ action: "add_time", startsAt: new Date(newTime).toISOString() })) setNewTime(""); }} type="button"><Plus size={18} />Добавить</button></div></section>
    <section className="panel"><h2>Места</h2>{event.placeOptions.map((item) => <div className="slot-card" key={item.id}><div><strong>{item.title}</strong><span>{item.area || "Район не указан"} · {plural(item.placeVoteCount ?? 0, "голос", "голоса", "голосов")}</span></div><button className="icon-action danger" onClick={() => void mutate({ action: "remove_place", placeOptionId: item.id })} title="Удалить место" type="button"><Trash2 size={18} /></button></div>)}<div className="add-place"><input placeholder="Место" value={place.title} onChange={(input) => setPlace({ ...place, title: input.target.value })} /><input placeholder="Район" value={place.area} onChange={(input) => setPlace({ ...place, area: input.target.value })} /><input min="0" type="number" value={place.estimatedBudget} onChange={(input) => setPlace({ ...place, estimatedBudget: Number(input.target.value) })} /><button className="secondary-action" disabled={!place.title.trim()} onClick={async () => { if (await mutate({ action: "add_place", place })) setPlace({ title: "", area: "", estimatedBudget: event.budgetLimit }); }} type="button"><Plus size={18} />Добавить</button></div></section>
    <section className="panel"><h2>Ответы участников</h2>{event.participants.length ? event.participants.map((person) => <details className="participant-answer" key={person.id}><summary><strong>{person.name}</strong><span>{person.area || "Район не указан"}</span></summary><div><p><b>Могу:</b> {event.timeOptions.filter((slot) => person.availableTimeOptionIds.includes(slot.id)).map((slot) => formatSlot(slot.startsAt)).join(" · ") || "нет"}</p><p><b>Не могу:</b> {event.timeOptions.filter((slot) => person.unavailableTimeOptionIds.includes(slot.id)).map((slot) => formatSlot(slot.startsAt)).join(" · ") || "нет"}</p><p><b>Места:</b> {event.placeOptions.filter((option) => person.selectedPlaceOptionIds?.includes(option.id)).map((option) => option.title).join(" · ") || "не указано"}</p><p><b>Бюджет:</b> {person.budget} BYN</p><p><b>Предпочтения:</b> {person.preferences || "нет"}</p><p><b>Ограничения:</b> {person.restrictions || "нет"}</p></div></details>) : <EmptyState title="Ответов пока нет" text="Пригласите участников по ссылке встречи." />}</section>
    <section className="panel decision-panel"><h2>Окончательное решение</h2>{event.status === "collecting" ? <><p>Закройте сбор ответов, когда будете готовы выбрать итог.</p><button className="primary-action" disabled={saving} onClick={() => void mutate({ action: "close" })} type="button">Закрыть сбор ответов</button></> : event.status === "place_selection" ? <><p>{best ? `Лучший вариант по голосованию: ${formatSlot(best.startsAt)}.` : "Выберите время и место вручную."}</p><label className="field"><span>Время</span><select value={finalTime} onChange={(input) => setFinalTime(input.target.value)}><option value="">Выберите время</option>{event.timeOptions.map((slot) => <option key={slot.id} value={slot.id}>{formatSlot(slot.startsAt)}</option>)}</select></label><label className="field"><span>Место</span><select value={finalPlace} onChange={(input) => setFinalPlace(input.target.value)}><option value="">Выберите место</option>{event.placeOptions.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.area}</option>)}</select></label>{(!finalTime || !finalPlace) && <p className="field-help">Выберите время и место, чтобы принять решение.</p>}<button className="primary-action" disabled={!finalTime || !finalPlace || saving} onClick={() => void mutate({ action: "decide", finalTimeOptionId: finalTime, finalPlaceId: finalPlace })} type="button">Принять решение</button><button className="text-action" onClick={() => void mutate({ action: "reopen" })} type="button">Возобновить сбор</button></> : <><p>Итог уже сохранён и виден участникам.</p><button className="secondary-action" onClick={() => void mutate({ action: "reopen" })} type="button">Возобновить сбор</button></>}</section>
    <div className="action-row"><button className="secondary-action" onClick={() => shareEvent(event.id)} type="button"><Send size={18} />Отправить в чат</button><button className="secondary-action" onClick={() => navigate(`/result/${event.id}`)} type="button">Открыть итог</button><button className="danger-button" onClick={async () => { if (confirm("Удалить встречу?")) { await api.remove(event.id); navigate("/my-events", true); } }} type="button"><Trash2 size={18} />Удалить</button></div>{state.error && <p className="form-error">{state.error}</p>}</section></main>;
}

function CalendarSheet({ event, time, place, onClose }: { event: EventData; time: NonNullable<ReturnType<typeof bestSlot>>; place: PlaceOption | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const description = [event.description, `Встреча в «Соберёмся»: ${miniAppLink(event.id)}`].filter(Boolean).join("\n\n"); const googleUrl = buildGoogleCalendarUrl({ title: event.title, description, location: [place?.title, place?.area].filter(Boolean).join(", "), startsAt: time.startsAt }); const ios = telegramPlatform().toLowerCase().includes("ios");
  const downloadIcs = async () => { setLoading(true); setError(""); try { const { icsUrl } = await api.calendarLink(event.id); openExternalUrl(icsUrl); } catch { setError("Не удалось подготовить файл календаря. Попробуйте ещё раз или используйте Google Calendar."); } finally { setLoading(false); } };
  return <div className="sheet-backdrop" role="presentation" onClick={onClose}><section className="calendar-sheet" role="dialog" aria-modal="true" aria-label="Добавить в календарь" onClick={(event) => event.stopPropagation()}><button className="icon-action sheet-close" onClick={onClose} title="Закрыть" type="button"><X size={20} /></button><h2>Добавить в календарь</h2><p>{ios ? "На iPhone откроется файл .ics в браузере: его можно добавить в Календарь или Файлы." : "Выберите удобный календарь."}</p>{error && <p className="form-error">{error}</p>}{ios ? <button className="primary-action" disabled={loading} onClick={() => void downloadIcs()} type="button">{loading ? "Готовим файл…" : "Скачать .ics"}</button> : <button className="primary-action" onClick={() => openExternalUrl(googleUrl)} type="button">Google Calendar</button>}<button className="secondary-action" disabled={loading} onClick={ios ? () => openExternalUrl(googleUrl) : () => void downloadIcs()} type="button">{ios ? "Google Calendar" : loading ? "Готовим файл…" : "Скачать .ics"}</button></section></div>;
}

function Result({ eventId, navigate, initial = null }: { eventId: string; navigate: Navigate; initial?: EventData | null }) {
  const state = useEvent(eventId); const event = initial ?? state.event; const [calendarOpen, setCalendarOpen] = useState(false); if (!event) return <main><Header navigate={navigate} />{state.error ? <RetryState message={state.error} onRetry={() => void state.load()} /> : <Loading />}</main>;
  const recommendedTime = event.timeOptions.find((item) => item.id === event.finalTimeOptionId) ?? bestSlot(event); const finalPlace = event.placeOptions.find((item) => item.id === event.finalPlaceId) ?? event.placeOptions[0] ?? null; const areas = areaLeaders(event); const tie = areas.length > 1;
  return <main><Header navigate={navigate} /><PageIntro eyebrow={event.status === "decided" ? "Встреча согласована" : "Текущая рекомендация"} title={event.title} compact><StatusBadge status={event.status} /></PageIntro><section className="result-page">{!initial && <Refresh refreshing={state.refreshing} lastUpdated={state.lastUpdated} onClick={() => void state.load()} />}<section className="result-hero"><span>{event.status === "decided" ? "Итог встречи" : "Лучший вариант сейчас"}</span><h2>{recommendedTime ? formatSlot(recommendedTime.startsAt) : "Пока нет голосов"}</h2><p>{finalPlace ? `${finalPlace.title}${finalPlace.area ? ` · ${finalPlace.area}` : ""}` : "Место ещё не выбрано"}</p>{event.budgetLimit > 0 && <p>До {event.budgetLimit} BYN</p>}</section>{event.description && <section className="panel"><h2>Комментарий</h2><p>{event.description}</p></section>}<div className="result-grid"><section className="panel"><Users size={22} /><h3>Участники</h3><strong className="result-value">{event.participants.length}</strong></section><section className="panel"><MapPin size={22} /><h3>Район</h3><strong className="result-value">{tie ? "Нет единого района" : areas[0]?.[0] ?? "Нет данных"}</strong>{areas.map(([area, count]) => <span key={area}>{area} — {plural(count, "голос", "голоса", "голосов")}</span>)}</section><section className="panel"><Clock3 size={22} /><h3>Могут прийти</h3><strong className="result-value">{recommendedTime?.availableCount ?? 0}</strong></section></div><section className="panel"><h2>Кто участвует</h2><div className="name-list">{event.participants.map((person) => <span key={person.id}>{person.name}</span>)}</div></section><div className="result-actions"><button className="secondary-action" disabled={!recommendedTime} onClick={() => setCalendarOpen(true)} type="button"><CalendarPlus size={18} />Добавить в календарь</button><button className="primary-action" onClick={() => shareResult(event, recommendedTime, finalPlace)} type="button"><Send size={18} />Поделиться итогом</button></div></section>{calendarOpen && recommendedTime && <CalendarSheet event={event} time={recommendedTime} place={finalPlace} onClose={() => setCalendarOpen(false)} />}</main>;
}

function miniAppLink(eventId: string) { const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "BOT_USERNAME"; const app = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME || "app"; return `https://t.me/${bot}/${app}?startapp=event_${eventId}`; }
function shareEvent(eventId: string) { const link = miniAppLink(eventId); openTelegramUrl(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Соберёмся?\nПроголосуйте за удобное время и место:")}`); }
function shareResult(event: EventData, time: EventData["timeOptions"][number] | null, place: PlaceOption | null) { const details = [`🎉 Собрались!`, "", event.title, time && `📅 ${formatSlot(time.startsAt)}`, place && `📍 ${place.title}${place.area ? ` · ${place.area}` : ""}`, "", "Открыть встречу:"].filter(Boolean).join("\n"); openTelegramUrl(`https://t.me/share/url?url=${encodeURIComponent(miniAppLink(event.id))}&text=${encodeURIComponent(details)}`); }

function OutsideTelegram() { const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || ""; return <main className="outside-screen"><section className="home-summary"><span>Telegram Mini App</span><h1>Соберёмся</h1><p>Откройте приложение через Telegram, чтобы создавать встречи и голосовать вместе.</p><button className="primary-action" disabled={!bot} onClick={() => openTelegramUrl(`https://t.me/${bot}`)} type="button">Открыть в Telegram</button></section></main>; }

export default function App() {
  const { path, navigate } = usePath(); const [auth, setAuth] = useState<AuthResult | null>(null); const [error, setError] = useState(""); const [outside, setOutside] = useState(false); const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  useTelegramBack(path, navigate, backOverride);
  useEffect(() => { telegram()?.MainButton?.hide(); }, [path]);
  useEffect(() => { const app = initializeTelegram(); const mock = import.meta.env.VITE_USE_MOCK_TELEGRAM === "true"; const raw = app?.initData || (mock ? import.meta.env.VITE_MOCK_INIT_DATA || "mock" : ""); if (!raw) { setOutside(true); return; } api.auth(raw).then((result) => { setAuth(result); if (result.startParam?.startsWith("event_")) navigate(`/event/${result.startParam.slice(6)}`, true); else { const screen = new URLSearchParams(window.location.search).get("screen"); if (screen === "create") navigate("/create", true); if (screen === "my-events") navigate("/my-events", true); } }).catch(() => setError("Не удалось подтвердить данные Telegram. Откройте Mini App заново.")); }, [navigate]);
  if (outside) return <OutsideTelegram />; if (error) return <main className="outside-screen"><RetryState message={error} /></main>; if (!auth) return <main className="outside-screen"><Loading label="Проверяем Telegram…" /></main>;
  const match = (pattern: RegExp) => path.match(pattern)?.[1]; const created = match(/^\/created\/([^/]+)$/); if (created) return <Created eventId={created} navigate={navigate} />; const manage = match(/^\/manage\/([^/]+)$/); if (manage) return <Manage eventId={manage} navigate={navigate} />; const result = match(/^\/result\/([^/]+)$/); if (result) return <Result eventId={result} navigate={navigate} />; const event = match(/^\/event\/([^/]+)$/); if (event) return <ParticipantEvent eventId={event} navigate={navigate} />; if (path === "/create") return <CreateEvent navigate={navigate} setBackOverride={setBackOverride} />; if (path === "/my-events") return <MyEvents navigate={navigate} />; return <Home navigate={navigate} user={auth.user} />;
}
