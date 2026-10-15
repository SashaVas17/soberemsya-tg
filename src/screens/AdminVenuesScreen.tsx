import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadCloud, ExternalLink, Search, X } from "lucide-react";
import { api } from "../api";
import { FEED_SEARCH_MAX_LENGTH, normalizeFeedSearch } from "../public-feed";
import { haptic, openExternalUrl } from "../telegram";
import type { AdminVenue, MeetingCategory, VenueDraft, VenuePriceLevel, VenueStatus } from "../types";
import type { Navigate } from "../app-types";
import { mergeVenues, PRICE_LEVELS } from "../venues";
import { CategoryChip, EmptyState, ErrorNote, Header, Loading, RetryState } from "../ui/common";
import { FeaturedBadge, OsmAttribution, VenueMeta } from "../ui/Venues";
import { t } from "../i18n";
import { fetchOverpassElements, type OverpassSource } from "../osm-import";

const statusTabs: { id: VenueStatus; label: string }[] = [
  { id: "pending", label: "Новые" },
  { id: "published", label: "Опубликованы" },
  { id: "hidden", label: "Скрыты" },
];

type VenueUpdate = Pick<AdminVenue, "status" | "categoryId" | "priceLevel" | "featured">;

function parsePriceLevel(value: string): VenuePriceLevel | null {
  return value === "1" || value === "2" || value === "3" ? (Number(value) as VenuePriceLevel) : null;
}

function PriceSelect({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: VenuePriceLevel | null) => void;
  value: VenuePriceLevel | null;
}) {
  return (
    <select
      aria-label={t("Цены")}
      disabled={disabled}
      onChange={(event) => onChange(parsePriceLevel(event.target.value))}
      value={value ?? ""}
    >
      <option value="">{t("Без цены")}</option>
      {PRICE_LEVELS.map((price) => (
        <option key={price.level} value={price.level}>{t(price.label)}</option>
      ))}
    </select>
  );
}

function AdminVenueCard({
  busy,
  categories,
  onUpdate,
  venue,
}: {
  busy: boolean;
  categories: MeetingCategory[];
  onUpdate: (update: VenueUpdate) => void;
  venue: AdminVenue;
}) {
  const current: VenueUpdate = {
    status: venue.status,
    categoryId: venue.categoryId,
    priceLevel: venue.priceLevel,
    featured: venue.featured,
  };
  const update = (change: Partial<VenueUpdate>) => onUpdate({ ...current, ...change });
  return (
    <article aria-busy={busy} className="panel admin-venue-card">
      <div className="admin-venue-heading">
        <strong>{venue.name}</strong>
        {venue.featured && <FeaturedBadge />}
      </div>
      <VenueMeta venue={venue} />
      {(venue.osmUrl || venue.website) && (
        <div className="admin-venue-links">
          {venue.osmUrl && (
            <button className="text-link-button" onClick={() => openExternalUrl(venue.osmUrl ?? "")} type="button">
              <ExternalLink aria-hidden="true" size={14} />
              OpenStreetMap
            </button>
          )}
          {venue.website && (
            <button className="text-link-button" onClick={() => openExternalUrl(venue.website ?? "")} type="button">
              <ExternalLink aria-hidden="true" size={14} />
              {t("Сайт")}</button>
          )}
        </div>
      )}
      <div className="admin-venue-fields">
        <select
          aria-label={t("Категория")}
          disabled={busy}
          onChange={(event) => update({ categoryId: event.target.value })}
          value={venue.categoryId}
        >
          {!categories.some((category) => category.id === venue.categoryId) && (
            <option value={venue.categoryId}>{venue.categoryId}</option>
          )}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{t(category.name)}</option>
          ))}
        </select>
        <PriceSelect disabled={busy} onChange={(priceLevel) => update({ priceLevel })} value={venue.priceLevel} />
      </div>
      <label className="admin-venue-featured">
        <input
          checked={venue.featured}
          disabled={busy}
          onChange={(event) => update({ featured: event.target.checked })}
          type="checkbox"
        />
        {t("Рекомендуем — показывать первым")}</label>
      <div className="admin-report-actions">
        {venue.status !== "published" && (
          <button
            className="primary-action compact-action"
            disabled={busy}
            onClick={() => update({ status: "published" })}
            type="button"
          >
            {t("Опубликовать")}</button>
        )}
        {venue.status !== "hidden" && (
          <button
            className="danger-button compact-action"
            disabled={busy}
            onClick={() => update({ status: "hidden" })}
            type="button"
          >
            {t("Скрыть")}</button>
        )}
        {venue.status === "hidden" && (
          <button
            className="secondary-action compact-action"
            disabled={busy}
            onClick={() => update({ status: "pending" })}
            type="button"
          >
            {t("На проверку")}</button>
        )}
      </div>
    </article>
  );
}

const emptyDraft = (categoryId: string): VenueDraft => ({
  categoryId,
  name: "",
  address: "",
  priceLevel: null,
  website: "",
});

function AddVenueForm({ categories, onAdded }: { categories: MeetingCategory[]; onAdded: () => void }) {
  const [draft, setDraft] = useState<VenueDraft>(() => emptyDraft(categories[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const categoryId = draft.categoryId || categories[0]?.id || "";
  const submit = async () => {
    if (saving) return;
    if (!draft.name.trim()) {
      setError(t("Укажите название места."));
      return;
    }
    setSaving(true);
    setError("");
    setDone("");
    try {
      await api.adminCreateVenue({ ...draft, categoryId });
      haptic();
      setDone(t("«{name}» опубликовано.", { name: draft.name.trim() }));
      setDraft(emptyDraft(categoryId));
      onAdded();
    } catch (reason) {
      haptic("error");
      setError(reason instanceof Error ? reason.message : t("Не удалось добавить место."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="admin-venue-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span>{t("Название")}</span>
        <input maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} />
      </label>
      <label className="field">
        <span>{t("Адрес")}</span>
        <input maxLength={200} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder={t("Улица, дом")} value={draft.address} />
      </label>
      <div className="admin-venue-fields">
        <select aria-label={t("Категория")} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })} value={categoryId}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{t(category.name)}</option>
          ))}
        </select>
        <PriceSelect onChange={(priceLevel) => setDraft({ ...draft, priceLevel })} value={draft.priceLevel} />
      </div>
      <label className="field">
        <span>{t("Сайт или страница")}</span>
        <input inputMode="url" maxLength={300} onChange={(event) => setDraft({ ...draft, website: event.target.value })} placeholder="https://" value={draft.website} />
      </label>
      <ErrorNote message={error} />
      {done && <p className="admin-venue-done" role="status">{done}</p>}
      <button className="primary-action" disabled={saving || !categoryId} type="submit">
        {saving ? t("Добавляем…") : t("Добавить и опубликовать")}
      </button>
    </form>
  );
}

function ImportPanel({
  categories,
  importCategories,
  overpass,
  onImported,
}: {
  categories: MeetingCategory[];
  importCategories: string[];
  /** Overpass servers and queries: the app asks them itself (src/osm-import.ts). */
  overpass: OverpassSource | null;
  onImported: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const nameOf = (id: string) => t(categories.find((category) => category.id === id)?.name ?? id);
  const run = async (ids: string[]) => {
    if (running || !ids.length) return;
    setRunning(true);
    setLog([]);
    let imported = false;
    try {
      // One category per request: an Overpass answer for the whole city could
      // outlast the function time limit.
      for (const id of ids) {
        setLog((lines) => [...lines, t("{category}: загружаем…", { category: nameOf(id) })]);
        try {
          const query = overpass?.queries[id];
          const elements = overpass && query ? await fetchOverpassElements(overpass.urls, query) : undefined;
          const result = await api.adminImportVenues(id, elements);
          imported = true;
          setLog((lines) => [
            ...lines.slice(0, -1),
            t("{category}: найдено {found}, новых {inserted}, обновлено {updated}", { category: nameOf(id), found: result.found, inserted: result.inserted, updated: result.updated }) +
              (result.truncated ? t(". Достигнут предел выдачи OpenStreetMap — часть мест могла не загрузиться") : ""),
          ]);
        } catch (reason) {
          setLog((lines) => [
            ...lines.slice(0, -1),
            `${nameOf(id)}: ${reason instanceof Error ? reason.message : t("не удалось загрузить")}`,
          ]);
          haptic("error");
          break;
        }
      }
    } finally {
      setRunning(false);
      if (imported) onImported();
    }
  };
  return (
    <div className="admin-venue-import">
      <p className="create-section-helper">
        {t("Места из OpenStreetMap попадают во вкладку «Новые» и ждут проверки. Повторная загрузка обновит адреса и названия, ваши решения сохранятся.")}</p>
      <div className="category-chips category-chips-wrap">
        {importCategories.map((id) => (
          <button
            className="category-chip"
            disabled={running}
            key={id}
            onClick={() => void run([id])}
            type="button"
          >
            {nameOf(id)}
          </button>
        ))}
      </div>
      <button
        className="secondary-action compact-action"
        disabled={running || !importCategories.length}
        onClick={() => void run(importCategories)}
        type="button"
      >
        <DownloadCloud aria-hidden="true" size={18} />
        {running ? t("Загружаем…") : t("Загрузить все категории")}
      </button>
      {log.length > 0 && (
        <ul aria-live="polite" className="admin-venue-import-log">
          {log.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

// Visible only to administrators: the API answers 404 to everyone else.
export function AdminVenuesScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [status, setStatus] = useState<VenueStatus>("pending");
  const [items, setItems] = useState<AdminVenue[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [categories, setCategories] = useState<MeetingCategory[]>([]);
  const [importCategories, setImportCategories] = useState<string[]>([]);
  const [overpass, setOverpass] = useState<OverpassSource | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(normalizeFeedSearch(searchInput)), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (offset = 0) => {
    const requestId = ++latestRequest.current;
    setError("");
    if (offset > 0) setLoadingMore(true);
    try {
      const page = await api.adminVenues(status, { category: categoryId, q: search }, offset);
      if (requestId !== latestRequest.current) return;
      setItems((current) => mergeVenues(offset > 0 ? current ?? [] : [], page.items));
      setNextOffset(page.nextOffset);
      if (page.categories) setCategories(page.categories);
      if (page.importCategories) setImportCategories(page.importCategories);
      if ("overpass" in page && page.overpass !== undefined) setOverpass(page.overpass);
    } catch (reason) {
      if (requestId === latestRequest.current)
        setError(reason instanceof Error ? reason.message : t("Не удалось загрузить места."));
    } finally {
      if (requestId === latestRequest.current) setLoadingMore(false);
    }
  }, [categoryId, search, status]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const updateVenue = async (venue: AdminVenue, update: VenueUpdate) => {
    if (busyId) return;
    setBusyId(venue.id);
    setActionError("");
    // A venue that no longer matches the tab or the category filter leaves the list.
    const leaves = update.status !== status || (categoryId !== null && update.categoryId !== categoryId);
    try {
      await api.adminUpdateVenue(venue.id, update);
      haptic();
      setItems((current) =>
        (current ?? []).flatMap((item) => {
          if (item.id !== venue.id) return [item];
          return leaves ? [] : [{ ...item, ...update }];
        }));
      // Keeps the next page from skipping a venue after one left the list.
      if (leaves) setNextOffset((offset) => (offset === null ? null : Math.max(0, offset - 1)));
    } catch (reason) {
      haptic("error");
      setActionError(reason instanceof Error ? reason.message : t("Не удалось сохранить место."));
    } finally {
      setBusyId(null);
    }
  };

  const publishShown = async () => {
    const ids = (items ?? []).map((item) => item.id).slice(0, 200);
    if (!ids.length || publishing) return;
    if (!window.confirm(t("Опубликовать все места на экране ({count})?", { count: ids.length }))) return;
    setPublishing(true);
    setActionError("");
    try {
      await api.adminPublishVenues(ids);
      haptic();
      await load();
    } catch (reason) {
      haptic("error");
      setActionError(reason instanceof Error ? reason.message : t("Не удалось опубликовать места."));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Каталог мест")} variant="nested" />
      <section className="settings-page admin-venues">
        <details className="panel admin-venue-section">
          <summary>{t("Загрузить из OpenStreetMap")}</summary>
          <ImportPanel
            categories={categories}
            importCategories={importCategories}
            overpass={overpass}
            onImported={() => void load()}
          />
        </details>
        <details className="panel admin-venue-section">
          <summary>{t("Добавить место вручную")}</summary>
          {categories.length > 0 && <AddVenueForm categories={categories} onAdded={() => void load()} />}
        </details>
        <div aria-label={t("Статус мест")} className="meeting-segments admin-report-tabs" role="tablist">
          {statusTabs.map((tab) => (
            <button
              aria-selected={status === tab.id}
              className={status === tab.id ? "selected" : ""}
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              role="tab"
              type="button"
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
        <div className="public-feed-filters">
          <div className="feed-search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label={t("Поиск по названию места")}
              maxLength={FEED_SEARCH_MAX_LENGTH}
              onChange={(event) => setSearchInput(event.target.value)}
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
          </div>
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
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {!items && !error && <Loading label={t("Загружаем места…")} />}
        {error && <RetryState message={error} onRetry={() => void load()} title={t("Места не загрузились")} />}
        {items?.length === 0 && !error && (
          <EmptyState
            text={status === "pending" ? t("Загрузите места из OpenStreetMap или добавьте вручную.") : t("Здесь пока пусто.")}
            title={status === "pending" ? t("Нет мест на проверке") : t("Мест нет")}
          />
        )}
        {status === "pending" && items && items.length > 1 && (
          <button
            className="secondary-action compact-action"
            disabled={publishing || busyId !== null}
            onClick={() => void publishShown()}
            type="button"
          >
            {publishing ? t("Публикуем…") : t("Опубликовать все на экране ({count})", { count: Math.min(items.length, 200) })}
          </button>
        )}
        {items?.map((venue) => (
          <AdminVenueCard
            busy={busyId === venue.id || publishing}
            categories={categories}
            key={venue.id}
            onUpdate={(update) => void updateVenue(venue, update)}
            venue={venue}
          />
        ))}
        {nextOffset !== null && items && (
          <button
            className="secondary-action public-feed-load-more"
            disabled={loadingMore}
            onClick={() => void load(nextOffset)}
            type="button"
          >
            {loadingMore ? t("Загружаем…") : t("Загрузить ещё")}
          </button>
        )}
        <OsmAttribution venues={items ?? []} />
      </section>
    </main>
  );
}
