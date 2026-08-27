import { applicationError } from "./errors.ts";
import type { Status } from "./domain.ts";

export type EventViewerRole = "owner" | "participant" | "private-invite";

export type PayloadEvent = {
  id: string;
  owner_user_id: string | null;
  title: string;
  description: string;
  budget_limit: number;
  visibility: string | null;
  max_participants: number | null;
  status: Status;
  final_place_id: string | null;
  final_time_option_id: string | null;
  created_at: string;
};
export type PayloadTime = { id: string; starts_at: string };
export type PayloadPlace = {
  id: string;
  title: string;
  area: string;
  estimated_budget: number;
};
export type PayloadParticipant = {
  id: string;
  user_id: string | null;
  name: string;
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
};
export type PayloadVote = {
  participant_id: string;
  time_option_id: string;
  is_available: boolean;
};

export type PayloadPlaceVote = {
  participant_id: string;
  place_option_id: string;
};

export type EventPayloadSource = {
  event: PayloadEvent;
  times: PayloadTime[];
  places: PayloadPlace[];
  participants: PayloadParticipant[];
  votes: PayloadVote[];
  placeVotes: PayloadPlaceVote[];
  currentUserId: string;
};

type DetailedParticipant = {
  id: string;
  userId: string | null;
  name: string;
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
  availableTimeOptionIds: string[];
  unavailableTimeOptionIds: string[];
};

type OwnResponse = Omit<DetailedParticipant, "id" | "userId"> & {
  selectedPlaceOptionIds: string[];
};

function voteState(votes: PayloadVote[]) {
  const available = new Map<string, string[]>();
  const unavailable = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const vote of votes) {
    const target = vote.is_available ? available : unavailable;
    target.set(vote.participant_id, [
      ...(target.get(vote.participant_id) ?? []),
      vote.time_option_id,
    ]);
    if (vote.is_available)
      counts.set(vote.time_option_id, (counts.get(vote.time_option_id) ?? 0) + 1);
  }
  return { available, unavailable, counts };
}

function commonEventPayload(source: EventPayloadSource) {
  const { event, times, places, votes } = source;
  const { counts } = voteState(votes);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    budgetLimit: event.budget_limit,
    visibility: event.visibility === "public" ? "public" : "private",
    maxParticipants: event.max_participants ?? null,
    status: event.status,
    finalPlaceId: event.final_place_id,
    finalTimeOptionId: event.final_time_option_id,
    timeOptions: times.map((time) => ({
      id: time.id,
      startsAt: time.starts_at,
      availableCount: counts.get(time.id) ?? 0,
    })),
    placeOptions: places.map((place) => ({
      id: place.id,
      title: place.title,
      area: place.area,
      estimatedBudget: place.estimated_budget,
    })),
    createdAt: event.created_at,
  };
}

function detailedParticipants(source: EventPayloadSource): DetailedParticipant[] {
  const { available, unavailable } = voteState(source.votes);
  return source.participants.map((participant) => ({
    id: participant.id,
    userId: participant.user_id,
    name: participant.name,
    area: participant.area,
    budget: participant.budget,
    preferences: participant.preferences,
    restrictions: participant.restrictions,
    availableTimeOptionIds: available.get(participant.id) ?? [],
    unavailableTimeOptionIds: unavailable.get(participant.id) ?? [],
  }));
}

function ownResponse(source: EventPayloadSource): OwnResponse | null {
  const person = detailedParticipants(source).find(
    (participant) => participant.userId === source.currentUserId,
  );
  if (!person) return null;
  const { id: _id, userId: _userId, ...response } = person;
  return {
    ...response,
    selectedPlaceOptionIds: source.placeVotes
      .filter((vote) => vote.participant_id === person.id)
      .map((vote) => vote.place_option_id),
  };
}

export function resolveEventViewerRole(input: {
  visibility?: string | null;
  ownerUserId: string | null;
  currentUserId: string;
  participantExists: boolean;
}): EventViewerRole {
  if (input.ownerUserId === input.currentUserId) return "owner";
  if (input.participantExists) return "participant";
  if (input.visibility !== "public") return "private-invite";
  throw applicationError(
    "PUBLIC_PREVIEW_REQUIRED",
    403,
    "Доступна только публичная информация о встрече.",
  );
}

export function organizerEventPayload(source: EventPayloadSource) {
  const participants = detailedParticipants(source);
  return {
    ...commonEventPayload(source),
    participants,
    canManage: true as const,
    myResponse:
      participants.find((participant) => participant.userId === source.currentUserId) ??
      null,
  };
}

export function participantEventPayload(source: EventPayloadSource) {
  return {
    ...commonEventPayload(source),
    participants: source.participants.map((participant) => ({
      name: participant.name,
      area: participant.area,
    })),
    canManage: false as const,
    myResponse: ownResponse(source),
  };
}

export function privateInviteEventPayload(source: EventPayloadSource) {
  return {
    ...commonEventPayload(source),
    participants: source.participants.map((participant) => ({ name: participant.name })),
    canManage: false as const,
    myResponse: null,
  };
}
