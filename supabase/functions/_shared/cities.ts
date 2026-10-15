// Cities (Stage 2.1). The table is the source of truth; these defaults keep
// the app working for users who have not chosen a city yet.
export const DEFAULT_CITY_ID = "minsk";
export const DEFAULT_TIME_ZONE = "Europe/Minsk";

const cityIdPattern = /^[a-z][a-z0-9-]{1,31}$/;

export type CityRow = {
  id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  sort_order: number;
};

export type City = {
  id: string;
  name: string;
  timeZone: string;
  isActive: boolean;
};

export type PublicCity = { id: string; name: string };

const fallbackCity: City = {
  id: DEFAULT_CITY_ID,
  name: "Минск",
  timeZone: DEFAULT_TIME_ZONE,
  isActive: true,
};

function badCity(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function parseCityId(value: unknown) {
  if (typeof value !== "string" || !cityIdPattern.test(value))
    badCity("Некорректный город.");
  return value;
}

export function citiesFromRows(rows: CityRow[]): City[] {
  return [...rows]
    .sort((left, right) =>
      left.sort_order - right.sort_order || left.name.localeCompare(right.name, "ru"),
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      timeZone: row.timezone,
      isActive: row.is_active,
    }));
}

export function activeCities(cities: City[]) {
  return cities.filter((city) => city.isActive);
}

/** The chosen city when it is active, otherwise the default city. */
export function resolveUserCity(cities: City[], chosenCityId: string | null | undefined): City {
  const active = activeCities(cities);
  return (
    active.find((city) => city.id === chosenCityId) ??
    active.find((city) => city.id === DEFAULT_CITY_ID) ??
    active[0] ??
    fallbackCity
  );
}

export function requireActiveCity(cities: City[], cityId: string): City {
  return (
    activeCities(cities).find((city) => city.id === cityId) ??
    badCity("Этот город пока недоступен.")
  );
}

/** Time zone of any city, active or not: a meeting keeps its city's zone. */
export function cityTimeZone(cities: City[], cityId: string | null | undefined) {
  return cities.find((city) => city.id === cityId)?.timeZone ?? DEFAULT_TIME_ZONE;
}

/**
 * The city an administrator works on in «Каталог мест»: any city, open or
 * not, so a catalog is filled before the city opens. Without a choice it is
 * the administrator's own city.
 */
export function adminCity(cities: City[], requestedCityId: unknown, ownCity: City): City {
  if (requestedCityId === undefined || requestedCityId === null || requestedCityId === "") return ownCity;
  const cityId = parseCityId(requestedCityId);
  return cities.find((city) => city.id === cityId) ?? badCity("Такого города нет.");
}

export type AdminCity = PublicCity & { isActive: boolean };

export function adminCityResponse(city: City): AdminCity {
  return { id: city.id, name: city.name, isActive: city.isActive };
}

export function parseCityActive(body: Record<string, unknown>) {
  if (typeof body.isActive !== "boolean") badCity("Некорректный запрос.");
  return { cityId: parseCityId(body.cityId), isActive: body.isActive };
}

export function cityHttpError(error: unknown) {
  const message = error && typeof error === "object" ? String((error as { message?: unknown }).message ?? "") : "";
  if (message.includes("CITY_DEFAULT_REQUIRED"))
    return Object.assign(new Error("Минск нельзя закрыть: это город по умолчанию."), { status: 400 });
  if (message.includes("CITY_INVALID")) return Object.assign(new Error("Такого города нет."), { status: 404 });
  return new Error("Не удалось изменить город.");
}

export function publicCity(city: City): PublicCity {
  return { id: city.id, name: city.name };
}

export function userCityResponse(cities: City[], chosenCityId: string | null | undefined) {
  return {
    city: publicCity(resolveUserCity(cities, chosenCityId)),
    cities: activeCities(cities).map(publicCity),
  };
}
