import type {
  AuthResult,
  MeetingListItem,
  PublicMeetingFeedItem,
} from "./types";
import { applyMockResponse, type MockVotingEvent } from "./participant-voting";
import { mockCreateJoinRequest } from "./join-request";
import {
  approveJoinRequest as mockApproveJoinRequest,
  listJoinRequests as mockListJoinRequests,
  rejectJoinRequest as mockRejectJoinRequest,
  type MockOrganizerJoinRequestRecord,
  type MockOrganizerJoinRequestState,
  type MockOrganizerRequesterProfile,
} from "./organizer-join-requests";
import {
  mockPublicEventAccess,
  mockPublicEventPreview,
  type MockPublicRole,
} from "./public-preview";

const future = (days: number, hour: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 30, 0, 0);
  return value.toISOString();
};
let event: MockVotingEvent = {
  id: "evt_demo",
  title: "Ужин с друзьями после работы",
  description: "Выберем время и место, которые подойдут всей компании.",
  budgetLimit: 35,
  visibility: "private",
  maxParticipants: null,
  status: "collecting",
  finalPlaceId: null,
  finalTimeOptionId: null,
  timeOptions: [
    { id: "time_1", startsAt: future(2, 18), availableCount: 2 },
    { id: "time_2", startsAt: future(3, 19), availableCount: 1 },
  ],
  placeOptions: [
    {
      id: "place_1",
      title: "Кафе у Ратуши",
      area: "Немига",
      estimatedBudget: 35,
    },
    {
      id: "place_2",
      title: "Бистро в центре",
      area: "Октябрьская",
      estimatedBudget: 30,
    },
  ],
  participants: [
    {
      id: "person_1",
      userId: "user_2",
      name: "Ирина",
      area: "Немига",
      budget: 35,
      preferences: "Тихий стол",
      restrictions: "Без орехов",
      availableTimeOptionIds: ["time_1"],
      unavailableTimeOptionIds: ["time_2"],
    },
    {
      id: "person_2",
      userId: "user_3",
      name: "Максим",
      area: "Октябрьская",
      budget: 40,
      preferences: "Можно с верандой",
      restrictions: "",
      availableTimeOptionIds: ["time_1", "time_2"],
      unavailableTimeOptionIds: [],
    },
  ],
  canManage: true,
  myResponse: null,
};

const auth: AuthResult = {
  user: {
    id: "user_demo",
    telegramUserId: "10001",
    username: "demo",
    firstName: "Александр",
    lastName: null,
    photoUrl: null,
  },
  startParam: null,
};
const clone = <T>(value: T): T => structuredClone(value);
let joinRequestStatus: "none" | "pending" | "rejected" = "none";
let organizerRequests: MockOrganizerJoinRequestRecord[] = [];
let organizerRequesterProfiles: MockOrganizerRequesterProfile[] = [];
let eventDeleted = false;
const organizerRequestState = (): MockOrganizerJoinRequestState => ({
  event: {
    id: event.id,
    ownerUserId: event.canManage ? auth.user.id : "user_owner",
    visibility: event.visibility,
    status: event.status,
    maxParticipants: event.maxParticipants,
    deleted: eventDeleted,
  },
  requests: organizerRequests,
  profiles: organizerRequesterProfiles,
  participants: event.participants,
});
const applyOrganizerRequestState = (state: MockOrganizerJoinRequestState) => {
  organizerRequests = state.requests;
  organizerRequesterProfiles = state.profiles;
  event.participants = state.participants;
};
const currentPublicRole = (): MockPublicRole => {
  if (event.canManage) return "owner";
  if (event.participants.some((person) => person.userId === auth.user.id))
    return "approved";
  return joinRequestStatus;
};
const mockDate = (startsAt: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(startsAt));
const mockTime = (startsAt: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).format(new Date(startsAt));
const listItem = (role: "owner" | "participant"): MeetingListItem => ({
  id: event.id,
  title: event.title,
  status: event.status,
  role,
  participantCount: event.participants.length,
  responseCount: event.participants.length,
  bestTime: event.timeOptions[0],
  timeSummary:
    event.status === "decided" && event.finalTimeOptionId
      ? (() => {
          const time = event.timeOptions.find(
            (option) => option.id === event.finalTimeOptionId,
          );
          return time ? `${mockDate(time.startsAt)} · ${mockTime(time.startsAt)}` : null;
        })()
      : event.timeOptions[0]
        ? mockDate(event.timeOptions[0].startsAt)
        : null,
  placeSummary:
    event.status === "decided"
      ? (event.placeOptions.find(
          (option) => option.id === event.finalPlaceId,
        )?.title ?? null)
      : null,
  createdAt: new Date().toISOString(),
});

export const mockApi = {
  auth: async () => clone(auth),
  event: async (eventId: string) => {
    void eventId;
    return mockPublicEventAccess(event, currentPublicRole());
  },
  publicEventPreview: async (eventId: string) => {
    void eventId;
    return mockPublicEventPreview(
      event,
      currentPublicRole(),
      currentPublicRole() === "owner" ? auth.user.id : "user_owner",
    );
  },
  publicMeetings: async (cursor?: string) => {
    void cursor;
    return {
      items: [
        {
          id: event.id,
          title: event.title,
          description: event.description,
          status: "collecting" as const,
          dateSummary: event.timeOptions[0]
            ? mockDate(event.timeOptions[0].startsAt)
            : null,
          budgetLimit: event.budgetLimit,
          participantCount: event.participants.length,
          maxParticipants: 6,
        } satisfies PublicMeetingFeedItem,
      ],
      nextCursor: null,
    };
  },
  createJoinRequest: async (eventId: string) => {
    void eventId;
    const result = mockCreateJoinRequest({
      eventStatus: event.status,
      visibility: event.visibility,
      isOwner: event.canManage,
      participantExists: event.participants.some(
        (person) => person.userId === auth.user.id,
      ),
      requestStatus: joinRequestStatus,
    });
    if (result.joinRequestStatus === "pending") joinRequestStatus = "pending";
    return result;
  },
  joinRequests: async (eventId: string) =>
    clone(mockListJoinRequests(organizerRequestState(), eventId, auth.user.id)),
  approveJoinRequest: async (eventId: string, requestId: string) => {
    const result = mockApproveJoinRequest(
      organizerRequestState(),
      eventId,
      requestId,
      auth.user.id,
    );
    applyOrganizerRequestState(result.state);
    return clone(result.response);
  },
  rejectJoinRequest: async (eventId: string, requestId: string) => {
    const result = mockRejectJoinRequest(
      organizerRequestState(),
      eventId,
      requestId,
      auth.user.id,
    );
    applyOrganizerRequestState(result.state);
    return clone(result.response);
  },
  createEvent: async (payload: any) => {
    joinRequestStatus = "none";
    organizerRequests = [];
    organizerRequesterProfiles = [];
    eventDeleted = false;
    event = {
      ...event,
      id: `evt_${Date.now()}`,
      title: payload.title,
      description: payload.description,
      budgetLimit: payload.budgetLimit,
      visibility: payload.visibility === "public" ? "public" : "private",
      maxParticipants:
        payload.visibility === "public" &&
        (payload.maxParticipants === null ||
          (typeof payload.maxParticipants === "number" &&
            Number.isInteger(payload.maxParticipants) &&
            payload.maxParticipants >= 2 &&
            payload.maxParticipants <= 50))
          ? payload.maxParticipants ?? null
          : null,
      timeOptions: payload.timeOptions.map(
        (startsAt: string, index: number) => ({
          id: `time_${index}`,
          startsAt,
          availableCount: 0,
        }),
      ),
      placeOptions: payload.placeOptions.map((place: any, index: number) => ({
        id: `place_${index}`,
        ...place,
      })),
      participants: [],
      myResponse: null,
    };
    return { event: clone(event) };
  },
  saveResponse: async (_id: string, payload: any) => {
    event = applyMockResponse(event, auth.user, payload);
    return { event: clone(event) };
  },
  leaveParticipation: async (id: string) => {
    if (id !== event.id)
      throw Object.assign(new Error("Встреча не найдена."), { status: 404 });
    if (event.canManage)
      throw Object.assign(new Error("Организатор не может покинуть встречу."), {
        status: 403,
      });
    const participant = event.participants.find(
      (person) => person.userId === auth.user.id,
    );
    if (!participant)
      throw Object.assign(new Error("Вы не участвуете в этой встрече."), {
        status: 404,
      });
    event = {
      ...event,
      participants: event.participants.filter(
        (person) => person.userId !== auth.user.id,
      ),
      myResponse: null,
    };
    return { left: true as const };
  },
  removeParticipant: async (eventId: string, participantId: string) => {
    if (eventId !== event.id)
      throw Object.assign(new Error("Встреча не найдена."), { status: 404 });
    if (event.myResponse?.id === participantId)
      throw Object.assign(new Error("Организатора нельзя исключить."), {
        status: 403,
      });
    if (!event.participants.some((person) => person.id === participantId))
      throw Object.assign(new Error("Участник не найден."), { status: 404 });
    event = {
      ...event,
      participants: event.participants.filter(
        (person) => person.id !== participantId,
      ),
    };
    return { removed: true as const };
  },
  meetings: async () => ({ owned: [listItem("owner")], participating: [] }),
  manage: async (_id: string, payload: any) => {
    if (payload.action === "update_details")
      event = {
        ...event,
        title: payload.title,
        description: payload.description,
      };
    if (payload.action === "close") event.status = "place_selection";
    if (payload.action === "reopen") event.status = "collecting";
    if (payload.action === "decide")
      event = {
        ...event,
        status: "decided",
        finalTimeOptionId: payload.finalTimeOptionId,
        finalPlaceId: payload.finalPlaceId,
      };
    return { event: clone(event) };
  },
  remove: async () => {
    eventDeleted = true;
    return { deleted: true as const };
  },
  calendarLink: async (eventId: string) => ({
    icsUrl: `https://example.test/calendar/${encodeURIComponent(eventId)}.ics?expires=0&signature=mock`,
  }),
};
