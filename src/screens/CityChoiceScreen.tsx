import { useState } from "react";
import { MapPin } from "lucide-react";
import { api } from "../api";
import { haptic } from "../telegram";
import type { City } from "../types";
import { ErrorNote } from "../ui/common";
import { t } from "../i18n";

/**
 * Asked once, on the first start after a second city opened: until the person
 * chooses, the app shows Minsk. Links to a meeting skip it; the city can be
 * changed later in «Открытые встречи».
 */
export function CityChoiceScreen({ cities, onDone }: { cities: City[]; onDone: () => void }) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const choose = async (cityId: string) => {
    if (savingId) return;
    setSavingId(cityId);
    setError("");
    try {
      await api.userCity(cityId);
      haptic();
      onDone();
    } catch (reason) {
      console.error("user_city_save_failed", reason);
      haptic("error");
      // The server says when a city has just closed.
      setError(reason instanceof Error && reason.message ? reason.message : t("Не удалось сменить город. Попробуйте ещё раз."));
      setSavingId(null);
    }
  };
  return (
    <main className="outside-screen">
      <section className="state-card city-choice">
        <span className="state-icon"><MapPin size={30} /></span>
        <h1>{t("Ваш город")}</h1>
        <p>{t("Покажем открытые встречи и места этого города. Сменить город можно в «Открытых встречах».")}</p>
        <div className="city-choice-list">
          {cities.map((city) => (
            <button
              aria-busy={savingId === city.id}
              className="secondary-action"
              disabled={savingId !== null}
              key={city.id}
              onClick={() => void choose(city.id)}
              type="button"
            >
              <MapPin aria-hidden="true" size={18} />
              {t(city.name)}
            </button>
          ))}
        </div>
        <ErrorNote message={error} />
        {/* Until chosen, the app shows Minsk; it asks again on the next start. */}
        <button className="text-link-button city-choice-later" disabled={savingId !== null} onClick={onDone} type="button">
          {t("Позже")}
        </button>
      </section>
    </main>
  );
}
