import { useState } from "react";
import { CalendarPlus, CalendarDays, Check, Clock3, MapPin, Send, Users } from "lucide-react";
import { api } from "../api";
import { googleCalendarUrl } from "../calendar";
import { areaLeaders, formatSlot, plural } from "../domain";
import { resultPlace, resultTime } from "../result-model";
import { openExternalUrl } from "../telegram";
import type { EventData } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState, Refresh } from "../ui/common";
import { useEvent } from "../app-hooks";
import { LeaveMeetingAction } from "../ui/LeaveMeetingAction";
import { usePreparedShare, shareResult } from "../share";

export function Result({
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
  const resultPrepared = usePreparedShare(event?.status === "decided" ? eventId : null, "result");
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
            onClick={() => shareResult(event.id, resultPrepared)}
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
