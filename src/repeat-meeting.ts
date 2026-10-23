import type { EditablePlaceDraft } from "./app-types";
import type { EventData, MeetingVisibility } from "./types";

// «Собрать ещё раз»: the organizer of a meeting opens the wizard filled from
// it — the same name, description, budget, mode, category and places (the
// chosen one first). Dates are new. Like a venue card (venues.ts), the
// wizard reads the template while it sets up and then clears it.

export type RepeatTemplate = {
  sourceEventId: string;
  title: string;
  description: string;
  budgetLimit: number;
  visibility: MeetingVisibility;
  maxParticipants: number | null;
  categoryId: string | null;
  places: EditablePlaceDraft[];
};

export function repeatTemplate(event: EventData): RepeatTemplate {
  const places = [...event.placeOptions].sort(
    (left, right) => Number(right.id === event.finalPlaceId) - Number(left.id === event.finalPlaceId),
  );
  return {
    sourceEventId: event.id,
    title: event.title,
    description: event.description,
    budgetLimit: event.budgetLimit,
    visibility: event.visibility,
    maxParticipants: event.maxParticipants,
    categoryId: event.category?.id ?? null,
    places: places.map((place) => ({
      title: place.title,
      area: place.area,
      estimatedBudget: String(place.estimatedBudget),
    })),
  };
}

let templateForNewMeeting: RepeatTemplate | null = null;

export function startRepeatMeeting(event: EventData) {
  templateForNewMeeting = repeatTemplate(event);
}

export function repeatForNextMeeting() {
  return templateForNewMeeting;
}

export function clearRepeatForNextMeeting() {
  templateForNewMeeting = null;
}
