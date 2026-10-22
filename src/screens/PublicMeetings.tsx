import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, MapPin, Search, SearchX, Users, X } from "lucide-react";
import { api } from "../api";
import { BottomNavigation } from "../BottomNavigation";
import { plural } from "../domain";
import {
  FEED_SEARCH_MAX_LENGTH,
  hasPublicFeedFilters,
  mergePublicMeetings,
  normalizeFeedSearch,
} from "../public-feed";
import type { City, MeetingCategory, PublicMeetingFeedItem } from "../types";
import type { Navigate } from "../app-types";
import { CategoryBadge, CategoryChip, Header, Loading, RetryState, EmptyState } from "../ui/common";
import { CommunityRulesDialog } from "../ui/Moderation";
import { Presence } from "../ui/Presence";
import { t } from "../i18n";

export function PublicMeetings({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [items, setItems] = useState<PublicMeetingFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [city, setCity] = useState<City | null>(null);
  const [cityChoices, setCityChoices] = useState<City[]>([]);
  const [savingCity, setSavingCity] = useState(false);
  // Only the latest feed request may update the list: after a city switch a
  // late answer for the previous city must not overwrite the new one.
  const latestRequest = useRef(0);
  const [cityError, setCityError] = useState("");
  const [categoryChoices, setCategoryChoices] = useState<MeetingCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // What the user types, and the search actually sent (settled after a pause).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // The rules are shown once, before the first look at open meetings.
  const [rulesPending, setRulesPending] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(normalizeFeedSearch(searchInput)), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // A new category or search re-creates load, and the effect below reloads
  // the first page; the cursor of the previous filter is dropped at once.
  const load = useCallback(async (cursor?: string) => {
    const requestId = ++latestRequest.current;
    const isLoadingMore = Boolean(cursor);
    if (isLoadingMore) setLoadingMore(true);
    else {
      setLoading(true);
      setNextCursor(null);
    }
    setError("");
    try {
      const result = await api.publicMeetings(cursor, { category: categoryId, q: search });
      if (requestId !== latestRequest.current) return;
      if (isLoadingMore) {
        setItems((current) => mergePublicMeetings(current, result.items));
      } else {
        setItems(mergePublicMeetings([], result.items));
      }
      setNextCursor(result.nextCursor);
      if (result.communityRulesAccepted === false) setRulesPending(true);
      if (result.city) setCity(result.city);
      if (result.cities) setCityChoices(result.cities);
      if (result.categories) {
        setCategoryChoices(result.categories);
        // The chosen category was deactivated: show all meetings instead.
        if (categoryId && !result.categories.some((choice) => choice.id === categoryId))
          setCategoryId(null);
      }
    } catch (reason) {
      if (requestId !== latestRequest.current) return;
      console.error("public_meetings_load_failed", reason);
      // Items of the previous filter must not stay under the new one.
      if (!isLoadingMore) setItems([]);
      setError(t("Не удалось загрузить открытые встречи."));
    } finally {
      if (requestId === latestRequest.current) {
        setLoadingMore(false);
        setLoading(false);
      }
    }
  }, [categoryId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseCity = async (cityId: string) => {
    setSavingCity(true);
    setCityError("");
    try {
      const next = await api.userCity(cityId);
      setCity(next.city);
      setCityChoices(next.cities);
      setItems([]);
      setNextCursor(null);
      await load();
    } catch (reason) {
      console.error("user_city_save_failed", reason);
      setCityError(t("Не удалось сменить город. Попробуйте ещё раз."));
    } finally {
      setSavingCity(false);
    }
  };

  const cityControl = city && (
    cityChoices.length > 1 ? (
      <label className="city-chip city-picker">
        <MapPin aria-hidden="true" size={16} />
        <select
          aria-label={t("Город")}
          disabled={savingCity}
          onChange={(event) => void chooseCity(event.target.value)}
          value={city.id}
        >
          {cityChoices.map((choice) => (
            <option key={choice.id} value={choice.id}>{t(choice.name)}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={16} />
      </label>
    ) : (
      <span className="city-chip">
        <MapPin aria-hidden="true" size={16} />
        {t(city.name)}
      </span>
    )
  );

  const filtered = hasPublicFeedFilters({ category: categoryId, q: search });
  const resetFilters = () => {
    setCategoryId(null);
    setSearchInput("");
    setSearch("");
  };
  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  const filters = (
    <div className="public-feed-filters">
      <div className="feed-search">
        <Search aria-hidden="true" size={18} />
        <input
          aria-label={t("Поиск по названию")}
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
            onClick={clearSearch}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      {categoryChoices.length > 0 && (
        <div aria-label={t("Категории")} className="category-chips" role="group">
          <button
            aria-pressed={categoryId === null}
            className={`category-chip${categoryId === null ? " selected" : ""}`}
            onClick={() => setCategoryId(null)}
            type="button"
          >
            {t("Все")}</button>
          {categoryChoices.map((choice) => (
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
  );

  const cards = items.length > 0 && (
    <div aria-busy={loading} className="meeting-group public-meeting-list">
      {items.map((item) => (
        <button
          className="meeting-card public-meeting-card"
          key={item.id}
          onClick={() => navigate(`/event/${item.id}`)}
          type="button"
        >
          <div className="public-meeting-card-heading">
            {item.category && <CategoryBadge category={item.category} />}
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
                : t("{count} из {max} участников", { count: item.participantCount, max: item.maxParticipants })}
            </span>
            <span>
              {item.budgetLimit > 0
                ? t("До {budget} BYN", { budget: item.budgetLimit })
                : t("Бюджет не указан")}
            </span>
          </div>
          <span className="meeting-card-action">{t("Подробнее")}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Flockly" variant="root" />
      <section className="public-meetings-page">
        <div className="page-intro public-meetings-intro">
          <h1>{t("Открытые встречи")}</h1>
          <p>{t("Найдите встречу и отправьте заявку на участие.")}</p>
          {cityControl}
          {cityError && <p className="city-error" role="alert">{cityError}</p>}
        </div>
        {filters}
        {loading && !items.length && (
          <Loading label={t("Загружаем открытые встречи…")} />
        )}
        {!loading && !items.length && !error && (filtered ? (
          <EmptyState
            action={
              <button className="secondary-action compact-action" onClick={resetFilters} type="button">
                {t("Сбросить фильтры")}</button>
            }
            icon={<SearchX aria-hidden="true" size={32} />}
            title={t("Ничего не нашлось")}
            text={t("Попробуйте другую категорию или другой запрос.")}
          />
        ) : (
          <EmptyState
            title={t("Пока нет открытых встреч")}
            text={t("Открытые встречи появятся здесь, когда организаторы начнут их собирать.")}
          />
        ))}
        {error && !items.length && (
          <RetryState
            message={error}
            onRetry={() => void load()}
            title={t("Не удалось загрузить открытые встречи.")}
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
              {t("Повторить")}</button>
          </div>
        )}
        {nextCursor && !error && (
          <button
            className="secondary-action public-feed-load-more"
            disabled={loadingMore || savingCity}
            onClick={() => void load(nextCursor)}
            type="button"
          >
            {loadingMore ? t("Загружаем…") : t("Загрузить ещё")}
          </button>
        )}
        <nav aria-label={t("Безопасность")} className="public-feed-safety-links">
          <button onClick={() => navigate("/rules")} type="button">{t("Правила")}</button>
          <button onClick={() => navigate("/blocked")} type="button">{t("Заблокированные")}</button>
        </nav>
      </section>
      <BottomNavigation currentPath="/open" navigate={navigate} />
      <Presence show={rulesPending}>
        <CommunityRulesDialog onAccepted={() => setRulesPending(false)} />
      </Presence>
    </main>
  );
}
