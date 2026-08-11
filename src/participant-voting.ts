import type { EventData } from "./types";

export type VotingDraft = {
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
  availableTimeOptionIds: string[];
};

export type SaveResponsePayload = VotingDraft;
export type SaveSubmissionLock = { current: boolean };

export function votingDraftFromEvent(event: EventData): VotingDraft {
  const own = event.myResponse;
  return {
    area: own?.area ?? "",
    budget: own?.budget ?? event.budgetLimit,
    preferences: own?.preferences ?? "",
    restrictions: own?.restrictions ?? "",
    availableTimeOptionIds:
      own?.availableTimeOptionIds ?? event.timeOptions.map((item) => item.id),
  };
}

export function toggleTimeOption(selected: string[], optionId: string) {
  return selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId];
}

export function saveResponsePayload(draft: VotingDraft): SaveResponsePayload {
  return {
    area: draft.area,
    budget: draft.budget,
    preferences: draft.preferences,
    restrictions: draft.restrictions,
    availableTimeOptionIds: draft.availableTimeOptionIds,
  };
}

export async function saveResponseOnce<T>(
  eventId: string,
  draft: VotingDraft,
  lock: SaveSubmissionLock,
  saveResponse: (id: string, payload: SaveResponsePayload) => Promise<T>,
) {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await saveResponse(eventId, saveResponsePayload(draft));
  } finally {
    lock.current = false;
  }
}
