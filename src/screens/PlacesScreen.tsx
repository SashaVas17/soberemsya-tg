import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock3, List, Map as MapIcon, MapPin, Search, SearchX, X } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import { FEED_SEARCH_MAX_LENGTH, normalizeFeedSearch } from "../public-feed";
import type { City, MapMeeting, MapPoints, MeetingCategory, Venue } from "../types";
import { mapMeetingTime } from "../map";
import type { Navigate } from "../app-types";
import { mergeVenues, startMeetingAtVenue } from "../venues";
import { CategoryBadge, CategoryChip, EmptyState, Header, Loading, RetryState } from "../ui/common";
import { OsmAttribution, VenueCard } from "../ui/Venues";
import { t } from "../i18n";

// React.lazy remembers a failed import, so a retry needs a fresh one.
const loadVenueMap = () => lazy(() => import("../ui/VenueMap"));

type MapSelection =
  | { kind: "venue"; venueId: string; venue: Venue | null; error: string }
  | { kind: "meetings"; meetings: MapMeeting[] };

// The map code is a separate file: if it cannot be downloaded (no network, a
// page left open across a deploy) the screen offers a retry instead of the
// whole app going blank.
class MapChunkBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("map_chunk_failed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <RetryState
        message={t("Проверьте соединение и попробуйте ещё раз.")}
        onRetry={() => {
          this.setState({ failed: false });
          this.props.onRetry();
        }}
        title={t("Карта не загрузилась")}
      />
    );
  }
}

// «Куда сходить»: curated venues of the viewer's city by category, as a list
// or on a map together with open meetings held at catalogue venues.
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
  const [view, setView] = useState<"list" | "map">("list");
  const [mapPoints, setMapPoints] = useState<MapPoints | null>(null);
  const [mapError, setMapError] = useState("");
  const [mapReload, setMapReload] = useState(0);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const latestMapRequest = useRef(0);
  const [VenueMap, setVenueMap] = useState(loadVenueMap);

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
      setError(t("Не удалось загрузить места."));
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [categoryId, search]);

  // The list loads only while it is shown: category taps on the map must not
  // also fetch a hidden list.
  useEffect(() => {
    if (view === "list") void load();
  }, [load, view]);

  // The map shows the chosen category; search applies to the list only.
  useEffect(() => {
    if (view !== "map") return;
    const requestId = ++latestMapRequest.current;
    setMapError("");
    setSelection(null);
    api.mapPoints(categoryId).then(
      (points) => {
        if (requestId === latestMapRequest.current) setMapPoints(points);
      },
      (reason) => {
        if (requestId !== latestMapRequest.current) return;
        console.error("map_points_load_failed", reason);
        setMapError(t("Не удалось загрузить карту."));
      },
    );
  }, [view, categoryId, mapReload]);

  const selectVenue = (venueId: string) => {
    setSelection({ kind: "venue", venueId, venue: null, error: "" });
    api.venue(venueId).then(
      ({ venue }) =>
        setSelection((current) =>
          current?.kind === "venue" && current.venueId === venueId ? { ...current, venue } : current),
      () =>
        setSelection((current) =>
          current?.kind === "venue" && current.venueId === venueId
            ? { ...current, error: t("Не удалось открыть место.") }
            : current),
    );
  };

  const filtered = Boolean(categoryId || search);
  const resetFilters = () => {
    setCategoryId(null);
    setSearchInput("");
    setSearch("");
  };
  const categoryById = (id: string | null) => categories.find((choice) => choice.id === id) ?? null;
  const categoryOf = (venue: Venue) => categoryById(venue.categoryId);
  const createMeetingAt = (venue: Venue) => {
    startMeetingAtVenue(venue);
    navigate("/create");
  };

  const viewSwitch = (
    <div aria-label={t("Вид")} className="meeting-segments places-view-switch" role="tablist">
      <button aria-selected={view === "list"} className={view === "list" ? "selected" : ""} onClick={() => setView("list")} role="tab" type="button">
        <List aria-hidden="true" size={16} />
        {t("Список")}</button>
      <button aria-selected={view === "map"} className={view === "map" ? "selected" : ""} onClick={() => setView("map")} role="tab" type="button">
        <MapIcon aria-hidden="true" size={16} />
        {t("Карта")}</button>
    </div>
  );

  const selectionSheet = selection && (
    <section aria-live="polite" className="map-selection">
      <button aria-label={t("Закрыть")} className="map-selection-close" onClick={() => setSelection(null)} type="button">
        <X aria-hidden="true" size={18} />
      </button>
      {selection.kind === "venue" && (selection.venue ? (
        <VenueCard
          category={categoryOf(selection.venue)}
          onCreateMeeting={() => selection.venue && createMeetingAt(selection.venue)}
          venue={selection.venue}
        />
      ) : (
        <p className="map-selection-status">{selection.error || t("Загружаем место…")}</p>
      ))}
      {selection.kind === "meetings" && selection.meetings.map((meeting) => (
        <article className="meeting-card public-meeting-card map-meeting-card" key={meeting.id}>
          <div className="public-meeting-card-heading">
            <div className="venue-badges">
              <span className="map-meeting-badge">{t("Открытая встреча")}</span>
              {categoryById(meeting.categoryId) && <CategoryBadge category={categoryById(meeting.categoryId)!} />}
            </div>
            <strong className="meeting-card-title">{meeting.title}</strong>
          </div>
          <div className="meeting-card-meta venue-meta">
            <span>
              <MapPin aria-hidden="true" size={15} />
              {meeting.venueName}
            </span>
            {meeting.startsAt && (
              <span>
                <Clock3 aria-hidden="true" size={15} />
                {t("Ближайший вариант:")} {mapMeetingTime(meeting.startsAt)}
              </span>
            )}
          </div>
          <button className="primary-action compact-action" onClick={() => navigate(`/event/${meeting.id}`)} type="button">
            {t("Подробнее")}</button>
        </article>
      ))}
    </section>
  );

  const mapView = (
    <>
      {mapError && (
        <RetryState message={mapError} onRetry={() => setMapReload((count) => count + 1)} title={t("Карта не загрузилась")} />
      )}
      {!mapError && !mapPoints && <Loading label={t("Загружаем карту…")} />}
      {!mapError && mapPoints && (
        <p className="map-legend">
          <span className="map-legend-venue" aria-hidden="true" /> {t("Места")}<span className="map-legend-meeting" aria-hidden="true" /> {t("Открытые встречи")}{mapPoints.venues.length === 0 && mapPoints.meetings.length === 0 && t(" · пока нет точек на карте")}
        </p>
      )}
      {!mapError && mapPoints && (
        <div className="venue-map-frame">
          <MapChunkBoundary onRetry={() => setVenueMap(loadVenueMap)}>
            <Suspense fallback={<Loading label={t("Загружаем карту…")} />}>
              <VenueMap
                onMeetings={(meetings) => setSelection({ kind: "meetings", meetings })}
                onVenue={selectVenue}
                points={mapPoints}
              />
            </Suspense>
          </MapChunkBoundary>
          {selectionSheet}
        </div>
      )}
    </>
  );

  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Flockly" variant="root" />
      <section className="public-meetings-page places-page">
        <div className={`page-intro public-meetings-intro${view === "map" ? " places-intro-compact" : ""}`}>
          <h1>{t("Куда сходить")}</h1>
          {/* On the map the space goes to the map itself. */}
          {view === "list" && <p>{t("Места для встреч в вашем городе. Выберите место и соберите компанию.")}</p>}
          {view === "list" && city && (
            <span className="city-chip">
              <MapPin aria-hidden="true" size={16} />
              {t(city.name)}
            </span>
          )}
        </div>
        {viewSwitch}
        <div className="public-feed-filters">
          {view === "list" && <div className="feed-search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label={t("Поиск по названию места")}
              enterKeyHint="search"
              maxLength={FEED_SEARCH_MAX_LENGTH}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                setSearch(normalizeFeedSearch(searchInput));
                event.currentTarget.blur();
              }}
              placeholder={t("Поиск по названию")}
              type="search"
              value={searchInput}
            />
            {searchInput && (
              <button
                aria-label={t("Очистить поиск")}
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
          </div>}
          {categories.length > 0 && (
            <div aria-label={t("Категории")} className="category-chips" role="group">
              <button
                aria-pressed={categoryId === null}
                className={`category-chip${categoryId === null ? " selected" : ""}`}
                onClick={() => setCategoryId(null)}
                type="button"
              >
                {t("Все")}</button>
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
        {view === "map" && mapView}
        {view === "list" && <>
        {loading && !items.length && <Loading label={t("Загружаем места…")} />}
        {!loading && !items.length && !error && (filtered ? (
          <EmptyState
            action={
              <button className="secondary-action compact-action" onClick={resetFilters} type="button">
                {t("Сбросить фильтры")}</button>
            }
            icon={<SearchX aria-hidden="true" size={32} />}
            text={t("Попробуйте другую категорию или другой запрос.")}
            title={t("Ничего не нашлось")}
          />
        ) : (
          <EmptyState
            text={t("Подборка мест для этого города готовится. Встречу можно создать и со своим местом.")}
            title={t("Мест пока нет")}
          />
        ))}
        {error && !items.length && (
          <RetryState message={error} onRetry={() => void load()} title={t("Места не загрузились")} />
        )}
        {items.length > 0 && (
          <div aria-busy={loading} className="meeting-group public-meeting-list">
            {items.map((venue) => (
              <VenueCard
                category={categoryOf(venue)}
                key={venue.id}
                onCreateMeeting={() => createMeetingAt(venue)}
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
              {t("Повторить")}</button>
          </div>
        )}
        {nextOffset !== null && !error && (
          <button
            className="secondary-action public-feed-load-more"
            disabled={loadingMore}
            onClick={() => void load(nextOffset)}
            type="button"
          >
            {loadingMore ? t("Загружаем…") : t("Загрузить ещё")}
          </button>
        )}
        <OsmAttribution venues={items} />
        </>}
      </section>
      <BottomNavigation currentPath="/places" navigate={navigate} />
    </main>
  );
}
