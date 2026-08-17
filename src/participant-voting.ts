import type { EventData, OrganizerEventData, Participant, TelegramUser } from "./types";

export type VotingDraft = {
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
  availableTimeOptionIds: string[];
};

export type SaveResponsePayload = VotingDraft;
export type SaveSubmissionLock = { current: boolean };
export type MockVotingEvent = Omit<OrganizerEventData, "canManage"> & {
  canManage: boolean;
};

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

function mockAuthorization(input: {
  visibility?: string | null;
  isOwner: boolean;
  participantId: string | null;
}) {
  const visibility = input.visibility === "public" ? "public" : "private";
  if (visibility === "private")
    return input.participantId ? "update" : "insert-private";
  if (input.isOwner)
    throw Object.assign(
      new Error("Организатор не может отвечать как участник открытой встречи."),
      { code: "PUBLIC_OWNER_CANNOT_RESPOND", status: 403 },
    );
  if (!input.participantId)
    throw Object.assign(
      new Error("Сначала отправьте заявку и дождитесь одобрения организатора."),
      { code: "PUBLIC_JOIN_REQUIRED", status: 403 },
    );
  return "update";
}

export function applyMockResponse(
  current: MockVotingEvent,
  currentUser: TelegramUser,
  payload: SaveResponsePayload,
) {
  const existing = current.participants.find(
    (person) => person.userId === currentUser.id,
  );
  const authorization = mockAuthorization({
    visibility: current.visibility,
    isOwner: current.canManage,
    participantId: existing?.id ?? null,
  });
  const participant: Participant = {
    id: existing?.id ?? "person_me",
    userId: currentUser.id,
    name: currentUser.firstName,
    area: payload.area,
    budget: payload.budget,
    preferences: payload.preferences,
    restrictions: payload.restrictions,
    availableTimeOptionIds: payload.availableTimeOptionIds,
    unavailableTimeOptionIds: current.timeOptions
      .filter((time) => !payload.availableTimeOptionIds.includes(time.id))
      .map((time) => time.id),
  };
  const participants =
    authorization === "update"
      ? current.participants.map((person) =>
          person.userId === currentUser.id ? participant : person,
        )
      : [...current.participants, participant];

  return {
    ...current,
    participants,
    myResponse: participant,
    timeOptions: current.timeOptions.map((time) => ({
      ...time,
      availableCount: participants.filter((person) =>
        person.availableTimeOptionIds.includes(time.id),
      ).length,
    })),
  };
}
