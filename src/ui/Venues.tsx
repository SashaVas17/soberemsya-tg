import { useEffect, useRef, useState } from "react";
import { Check, Clock3, ExternalLink, MapPin, Plus, Star, Wallet } from "lucide-react";
import { api } from "../api";
import { openExternalUrl } from "../telegram";
import type { MeetingCategory, Venue } from "../types";
import {
  isVenueAdded,
  mergeVenues,
  needsOsmAttribution,
  OSM_ATTRIBUTION_URL,
  priceLabel,
} from "../venues";
import { CategoryBadge, CategoryChip } from "./common";
import { t } from "../i18n";

export function OsmAttribution({ venues }: { venues: Pick<Venue, "source">[] }) {
  if (!needsOsmAttribution(venues)) return null;
  return (
    <p className="osm-attribution">
      {t("Данные о местах:")}{" "}
      <a
        href={OSM_ATTRIBUTION_URL}
        onClick={(event) => {
          event.preventDefault();
          openExternalUrl(OSM_ATTRIBUTION_URL);
        }}
        rel="noreferrer"
        target="_blank"
      >
        {t("© участники OpenStreetMap")}</a>
    </p>
  );
}

/** Address, price and opening hours of a venue, each when known. */
export function VenueMeta({ venue }: { venue: Venue }) {
  const price = priceLabel(venue.priceLevel);
  return (
    <div className="meeting-card-meta venue-meta">
      {venue.address && (
        <span>
          <MapPin aria-hidden="true" size={15} />
          {venue.address}
        </span>
      )}
      {price && (
        <span>
          <Wallet aria-hidden="true" size={15} />
          {price}  {t("на человека")}</span>
      )}
      {venue.openingHours && (
        <span>
          <Clock3 aria-hidden="true" size={15} />
          <span translate="no">{venue.openingHours}</span>
        </span>
      )}
    </div>
  );
}

export function FeaturedBadge() {
  return (
    <span className="venue-featured-badge">
      <Star aria-hidden="true" size={13} />
      {t("Рекомендуем")}</span>
  );
}

export function VenueCard({
  category,
  onCreateMeeting,
  venue,
}: {
  category: MeetingCategory | null;
  onCreateMeeting: () => void;
  venue: Venue;
}) {
  const link = venue.website ?? venue.osmUrl;
  return (
    <article className="meeting-card public-meeting-card venue-card">
      <div className="public-meeting-card-heading">
        <div className="venue-badges">
          {category && <CategoryBadge category={category} />}
          {venue.featured && <FeaturedBadge />}
        </div>
        <strong className="meeting-card-title">{venue.name}</strong>
      </div>
      <VenueMeta venue={venue} />
      <div className="venue-card-actions">
        <button className="primary-action compact-action" onClick={onCreateMeeting} type="button">
          <Plus aria-hidden="true" size={18} />
          {t("Создать встречу")}</button>
        {link && (
          <button
            className="secondary-action compact-action"
            onClick={() => openExternalUrl(link)}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={16} />
            {venue.website ? t("Сайт") : t("На карте")}
          </button>
        )}
      </div>
    </article>
  );
}

const PICKER_STEP = 5;

/**
 * Catalogue picks in the «Где?» step of the creation wizard: venues of the
 * meeting's category that fit its budget. Hidden while the catalogue of the
 * city is empty, so the wizard looks as before until venues are curated.
 */
export function VenuePicker({
  budget,
  categories,
  initialCategoryId,
  onPick,
  places,
}: {
  budget: number;
  categories: MeetingCategory[];
  initialCategoryId: string | null;
  onPick: (venue: Venue) => void;
  places: { title: string; area: string }[];
}) {
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [items, setItems] = useState<Venue[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [visible, setVisible] = useState(PICKER_STEP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Unknown until a load finds venues or an unfiltered check finds none.
  const [catalogEmpty, setCatalogEmpty] = useState<boolean | null>(null);
  const [settledBudget, setSettledBudget] = useState(budget);
  const latestRequest = useRef(0);
  const catalogChecked = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledBudget(budget), 400);
    return () => window.clearTimeout(timer);
  }, [budget]);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    setVisible(PICKER_STEP);
    api.venues({ category: categoryId, budget: settledBudget })
      .then((page) => {
        if (requestId !== latestRequest.current) return;
        setItems(page.items);
        setNextOffset(page.nextOffset);
        if (catalogChecked.current) return;
        if (page.items.length > 0 || (!categoryId && settledBudget <= 0)) {
          catalogChecked.current = true;
          setCatalogEmpty(page.items.length === 0);
          return;
        }
        // Nothing fits the filter: the picker stays only if the city has venues at all.
        catalogChecked.current = true;
        void api.venues().then(
          (all) => setCatalogEmpty(all.items.length === 0),
          () => setCatalogEmpty(false),
        );
      })
      .catch((reason) => {
        if (requestId !== latestRequest.current) return;
        console.error("venues_load_failed", reason);
        setItems([]);
        setError(t("Подборка мест не загрузилась."));
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false);
      });
  }, [categoryId, settledBudget]);

  const showMore = async () => {
    if (visible < items.length) {
      setVisible((count) => count + PICKER_STEP);
      return;
    }
    if (nextOffset === null) return;
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      const page = await api.venues({ category: categoryId, budget: settledBudget }, nextOffset);
      if (requestId !== latestRequest.current) return;
      setItems((current) => mergeVenues(current, page.items));
      setNextOffset(page.nextOffset);
      setVisible((count) => count + PICKER_STEP);
    } catch (reason) {
      if (requestId === latestRequest.current) {
        console.error("venues_load_failed", reason);
        setError(t("Подборка мест не загрузилась."));
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  };

  // Optional: until the city is known to have venues, the wizard looks as before.
  if (catalogEmpty !== false && items.length === 0) return null;
  const shown = items.slice(0, visible);
  const canShowMore = visible < items.length || nextOffset !== null;
  const categoryName = (id: string) => {
    const name = categories.find((category) => category.id === id)?.name;
    return name ? t(name) : undefined;
  };

  return (
    <section aria-busy={loading} className="venue-picker" aria-label={t("Подборка мест")}>
      <div className="venue-picker-heading">
        <h3>{t("Подборка мест")}</h3>
        <p className="create-section-helper">
          {budget > 0 ? t("По категории и бюджету до {budget} BYN.", { budget }) : t("По категории встречи.")}  {t("Нажмите, чтобы добавить вариант.")}</p>
      </div>
      {categories.length > 0 && (
        <div aria-label={t("Категория мест")} className="category-chips" role="group">
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
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="create-empty-options">{t("Подходящих мест пока нет — добавьте своё ниже.")}</p>
      )}
      {shown.length > 0 && (
        <ul className="venue-picker-list">
          {shown.map((venue) => {
            const added = isVenueAdded(venue, places);
            const price = priceLabel(venue.priceLevel);
            const details = [venue.address, price, categoryId ? null : categoryName(venue.categoryId)]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={venue.id}>
                <button
                  aria-label={added ? t("«{name}» уже добавлено", { name: venue.name }) : t("Добавить «{name}»", { name: venue.name })}
                  className={`venue-pick${added ? " added" : ""}`}
                  disabled={added}
                  onClick={() => onPick(venue)}
                  type="button"
                >
                  <span className="venue-pick-text">
                    <strong>
                      {venue.name}
                      {venue.featured && <Star aria-hidden="true" className="venue-pick-star" size={14} />}
                    </strong>
                    {details && <small>{details}</small>}
                  </span>
                  <span className="venue-pick-icon">
                    {added ? <Check aria-hidden="true" size={18} /> : <Plus aria-hidden="true" size={18} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canShowMore && !error && (
        <button
          className="secondary-action compact-action venue-picker-more"
          disabled={loading}
          onClick={() => void showMore()}
          type="button"
        >
          {t("Ещё места")}</button>
      )}
      <OsmAttribution venues={shown} />
    </section>
  );
}
