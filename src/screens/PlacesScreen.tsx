import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Search, SearchX, X } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import { FEED_SEARCH_MAX_LENGTH, normalizeFeedSearch } from "../public-feed";
import type { City, MeetingCategory, Venue } from "../types";
import type { Navigate } from "../app-types";
import { mergeVenues, startMeetingAtVenue } from "../venues";
import { CategoryChip, EmptyState, Header, Loading, RetryState } from "../ui/common";
import { OsmAttribution, VenueCard } from "../ui/Venues";

// «Куда сходить»: curated venues of the viewer's city by category. A map of
// the same venues comes in Stage 4.
export function PlacesScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [items, setItems] = useState<Venue[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [city, setCity] = useState<City | null>(null);
  const [categories, setCategories] = useState<MeetingCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const latestRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(normalizeFeedSearch(searchInput)), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (offset = 0) => {
    const requestId = ++latestRequest.current;
    const more = offset > 0;
    if (more) setLoadingMore(true);
    else {
      setLoading(true);
      setNextOffset(null);
    }
    setError("");
    try {
      const page = await api.venues({ category: categoryId, q: search }, offset);
      if (requestId !== latestRequest.current) return;
      setItems((current) => mergeVenues(more ? current : [], page.items));
      setNextOffset(page.nextOffset);
      if (page.city) setCity(page.city);
      if (page.categories) {
        setCategories(page.categories);
        if (categoryId && !page.categories.some((choice) => choice.id === categoryId)) setCategoryId(null);
      }
    } catch (reason) {
      if (requestId !== latestRequest.current) return;
      console.error("venues_load_failed", reason);
      if (!more) setItems([]);
      setError("Не удалось загрузить места.");
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [categoryId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = Boolean(categoryId || search);
  const resetFilters = () => {
    setCategoryId(null);
    setSearchInput("");
    setSearch("");
  };
  const categoryOf = (venue: Venue) => categories.find((choice) => choice.id === venue.categoryId) ?? null;

  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Flockly" variant="root" />
      <section className="public-meetings-page places-page">
        <div className="page-intro public-meetings-intro">
          <h1>Куда сходить</h1>
          <p>Места для встреч в вашем городе. Выберите место и соберите компанию.</p>
          {city && (
            <span className="city-chip">
              <MapPin aria-hidden="true" size={16} />
              {city.name}
            </span>
          )}
        </div>
        <div className="public-feed-filters">
          <div className="feed-search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Поиск по названию места"
              enterKeyHint="search"
              maxLength={FEED_SEARCH_MAX_LENGTH}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                setSearch(normalizeFeedSearch(searchInput));
                event.currentTarget.blur();
              }}
              placeholder="Поиск по названию"
              type="search"
              value={searchInput}
            />
            {searchInput && (
              <button
                aria-label="Очистить поиск"
                className="feed-search-clear"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            )}
          </div>
          {categories.length > 0 && (
            <div aria-label="Категории" className="category-chips" role="group">
              <button
                aria-pressed={categoryId === null}
                className={`category-chip${categoryId === null ? " selected" : ""}`}
                onClick={() => setCategoryId(null)}
                type="button"
              >
                Все
              </button>
              {categories.map((choice) => (
                <CategoryChip
                  category={choice}
                  key={choice.id}
                  onToggle={() => setCategoryId(categoryId === choice.id ? null : choice.id)}
                  selected={categoryId === choice.id}
                />
              ))}
            </div>
          )}
        </div>
        {loading && !items.length && <Loading label="Загружаем места…" />}
        {!loading && !items.length && !error && (filtered ? (
          <EmptyState
            action={
              <button className="secondary-action compact-action" onClick={resetFilters} type="button">
                Сбросить фильтры
              </button>
            }
            icon={<SearchX aria-hidden="true" size={32} />}
            text="Попробуйте другую категорию или другой запрос."
            title="Ничего не нашлось"
          />
        ) : (
          <EmptyState
            text="Подборка мест для этого города готовится. Встречу можно создать и со своим местом."
            title="Мест пока нет"
          />
        ))}
        {error && !items.length && (
          <RetryState message={error} onRetry={() => void load()} title="Места не загрузились" />
        )}
        {items.length > 0 && (
          <div aria-busy={loading} className="meeting-group public-meeting-list">
            {items.map((venue) => (
              <VenueCard
                category={categoryOf(venue)}
                key={venue.id}
                onCreateMeeting={() => {
                  startMeetingAtVenue(venue);
                  navigate("/create");
                }}
                venue={venue}
              />
            ))}
          </div>
        )}
        {error && items.length > 0 && (
          <div className="public-feed-pagination-error" role="alert">
            <span>{error}</span>
            <button
              className="secondary-action compact-action"
              onClick={() => void load(nextOffset ?? 0)}
              type="button"
            >
              Повторить
            </button>
          </div>
        )}
        {nextOffset !== null && !error && (
          <button
            className="secondary-action public-feed-load-more"
            disabled={loadingMore}
            onClick={() => void load(nextOffset)}
            type="button"
          >
            {loadingMore ? "Загружаем…" : "Загрузить ещё"}
          </button>
        )}
        <OsmAttribution venues={items} />
      </section>
      <BottomNavigation currentPath="/places" navigate={navigate} />
    </main>
  );
}
