import { useCallback, useEffect, useState } from "react";
import { Clock3, Users } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import { plural } from "../domain";
import { mergePublicMeetings } from "../public-feed";
import type { PublicMeetingFeedItem } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState, EmptyState } from "../ui/common";

export function PublicMeetings({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
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
      <Header navigate={navigate} onBack={onBack} title="Flockly" variant="root" />
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
