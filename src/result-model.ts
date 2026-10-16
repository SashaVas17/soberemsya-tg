import { bestSlot } from "./domain";
import type { EventData } from "./types";

export function resultTime(event: EventData) {
  return (
    event.timeOptions.find((item) => item.id === event.finalTimeOptionId) ??
    bestSlot(event)
  );
}

export function resultPlace(event: EventData) {
  return (
    event.placeOptions.find((item) => item.id === event.finalPlaceId) ??
    event.placeOptions[0] ??
    null
  );
}
