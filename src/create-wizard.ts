import type { MeetingVisibility } from "./types";

export type { MeetingVisibility } from "./types";

export type PlaceDraft = {
  title: string;
  area: string;
  estimatedBudget: number;
};

export type CreateWizardDraft = {
  title: string;
  description: string;
  budgetLimit: number;
  visibility: MeetingVisibility;
  maxParticipants: number | null;
  timeOptions: string[];
  places: PlaceDraft[];
};

export type CreateEventPayload = {
  title: string;
  description: string;
  budgetLimit: number;
  visibility: MeetingVisibility;
  maxParticipants: number | null;
  timeOptions: string[];
  placeOptions: PlaceDraft[];
};

export type SubmissionLock = { current: boolean };

export function validateCreateStep(step: number, draft: CreateWizardDraft) {
  if (step === 1 && !draft.title.trim()) {
    return "Введите название встречи.";
  }
  if (step === 1) {
    if (draft.visibility === "private" && draft.maxParticipants !== null)
      return "Для встречи по приглашению лимит участников не задаётся.";
    if (
      draft.visibility === "public" &&
      draft.maxParticipants !== null &&
      (!Number.isInteger(draft.maxParticipants) ||
        draft.maxParticipants < 2 ||
        draft.maxParticipants > 50)
    )
      return "Лимит участников должен быть целым числом от 2 до 50.";
  }
  if (
    step === 2 &&
    !draft.timeOptions.some((option) => !Number.isNaN(Date.parse(option)))
  ) {
    return "Добавьте хотя бы один вариант даты и времени.";
  }
  return "";
}

export function createEventPayload(
  draft: CreateWizardDraft,
): CreateEventPayload {
  return {
    title: draft.title,
    description: draft.description,
    budgetLimit: draft.budgetLimit,
    visibility: draft.visibility,
    maxParticipants:
      draft.visibility === "private" ? null : draft.maxParticipants,
    timeOptions: draft.timeOptions,
    placeOptions: draft.places.filter((place) => place.title.trim()),
  };
}

export function addTimeOption(options: string[], option: string) {
  if (options.includes(option)) return options;
  return [...options, option].sort();
}

export function createTimeOption(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function removeTimeOption(options: string[], option: string) {
  return options.filter((value) => value !== option);
}

export function previousCreateStep(step: number) {
  return Math.max(1, step - 1);
}

export function advanceCreateStep(step: number, draft: CreateWizardDraft) {
  const error = validateCreateStep(step, draft);
  return {
    error,
    step: error ? step : Math.min(3, step + 1),
  };
}

export function createdEventPath(eventId: string) {
  return `/created/${eventId}`;
}

export async function submitCreateEventOnce<T extends { event: { id: string } }>(
  draft: CreateWizardDraft,
  lock: SubmissionLock,
  createEvent: (payload: CreateEventPayload) => Promise<T>,
) {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await createEvent(createEventPayload(draft));
  } finally {
    lock.current = false;
  }
}
