import type {
  AdminReport,
  AuthResult,
  BlockedUser,
  City,
  MeetingCategory,
  MeetingListItem,
  NotificationSettings,
  PublicMeetingFeedItem,
  ReportStatus,
  UserCity,
} from "./types";
import type { ModerationTarget } from "./moderation";
import { normalizeFeedSearch, type PublicFeedFilters } from "./public-feed";
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
  startParam: new URLSearchParams(globalThis.location?.search ?? "").get("mockStartParam"),
  isAdmin: true,
};
const clone = <T>(value: T): T => structuredClone(value);
const cloneEventResponse = () => ({
  event: { ...clone(event), category: mockEventCategory() } as unknown as import("./types").EventData,
});
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

const mockOwnedMeetingPages = Array.from({ length: 13 }, (_, index) => ({
  ...listItem("owner"),
  id: `mock_owner_meeting_${index + 1}`,
  title: index === 0 ? event.title : `Тестовая встреча ${index + 1}`,
  createdAt: new Date(Date.now() - index * 60_000).toISOString(),
}));

function assertMockParticipantProposalAllowed(eventId: string) {
  if (eventId !== event.id)
    throw Object.assign(new Error("Встреча не найдена."), { status: 404 });
  if (event.canManage || event.status !== "collecting")
    throw Object.assign(new Error("Сейчас нельзя предложить вариант."), { status: 409 });
  if (event.visibility === "public" && currentPublicRole() !== "approved")
    throw Object.assign(
      new Error("Предлагать варианты могут только участники встречи."),
      { status: 403 },
    );
}

// Like production: only Minsk is open for now.
const mockCities: City[] = [{ id: "minsk", name: "Минск" }];
let mockCity: City = mockCities[0];

// Same list as the meeting_categories migration.
const mockCategories: MeetingCategory[] = [
  { id: "coffee", name: "Кофе" },
  { id: "bar", name: "Бар" },
  { id: "sport", name: "Спорт" },
  { id: "boardgames", name: "Настолки" },
  { id: "walk", name: "Прогулка" },
  { id: "cinema", name: "Кино" },
  { id: "concert", name: "Концерт" },
  { id: "outdoor", name: "Активный отдых" },
  { id: "other", name: "Другое" },
];
let mockEventCategoryId: string | null = "bar";

function mockEventCategory() {
  return mockCategories.find((category) => category.id === mockEventCategoryId) ?? null;
}

let mockNotificationSettings: NotificationSettings = {
  responseMode: "summary",
  reminder24h: true,
  reminder2h: true,
  canMessage: null,
};

let mockRulesAccepted = false;
let mockBlockedUsers: BlockedUser[] = [];
let mockReports: AdminReport[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    status: "open",
    targetType: "event",
    reason: "spam",
    comment: "В описании реклама кальянной.",
    createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    resolvedAt: null,
    reporter: { name: "Ольга", username: "olga" },
    event: { id: "evt_demo", title: "Кальян и настолки", status: "collecting", visibility: "public", hidden: false, deleted: false },
    targetUser: { id: "00000000-0000-4000-8000-0000000000aa", name: "Игорь", username: "igor_promo", banned: false },
    openReportsOnTarget: 2,
  },
];

export const mockApi = {
  auth: async () => clone(auth),
  event: async (eventId: string) => {
    void eventId;
    const result = mockPublicEventAccess(event, currentPublicRole());
    return { event: { ...result.event, category: mockEventCategory() } };
  },
  publicEventPreview: async (eventId: string) => {
    void eventId;
    const result = mockPublicEventPreview(
      event,
      currentPublicRole(),
      currentPublicRole() === "owner" ? auth.user.id : "user_owner",
    );
    return { ...result, preview: { ...result.preview, category: mockEventCategory() } };
  },
  categories: async () => ({ categories: mockCategories }),
  publicMeetings: async (cursor?: string, filters?: PublicFeedFilters) => {
    void cursor;
    const search = normalizeFeedSearch(filters?.q ?? "").toLocaleLowerCase("ru");
    const matches =
      (!filters?.category || filters.category === mockEventCategoryId) &&
      (!search || event.title.toLocaleLowerCase("ru").includes(search));
    return {
      items: matches ? [
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
          category: mockEventCategory(),
        } satisfies PublicMeetingFeedItem,
      ] : [],
      nextCursor: null,
      city: mockCity,
      cities: mockCities,
      categories: mockCategories,
      communityRulesAccepted: mockRulesAccepted,
    };
  },
  acceptCommunityRules: async () => {
    mockRulesAccepted = true;
    return { communityRulesAccepted: true as const };
  },
  reportEvent: async () => ({ reported: true as const, alreadyReported: false }),
  blockFromEvent: async (target: ModerationTarget) => {
    const userId = target.kind === "organizer" ? "user_owner" : `user_${target.kind}`;
    if (!mockBlockedUsers.some((user) => user.userId === userId))
      mockBlockedUsers = [
        { userId, name: target.kind === "organizer" ? "Организатор" : "Участник", username: null, blockedAt: new Date().toISOString() },
        ...mockBlockedUsers,
      ];
    return { blocked: true as const };
  },
  blockedUsers: async () => ({ users: clone(mockBlockedUsers) }),
  unblockUser: async (userId: string) => {
    mockBlockedUsers = mockBlockedUsers.filter((user) => user.userId !== userId);
    return { unblocked: true as const };
  },
  adminReports: async (status: ReportStatus) => ({
    reports: clone(mockReports.filter((report) => report.status === status)),
  }),
  adminResolveReport: async (reportId: string, action: "resolve" | "dismiss") => {
    const status: ReportStatus = action === "resolve" ? "resolved" : "dismissed";
    mockReports = mockReports.map((report) =>
      report.id === reportId && report.status === "open"
        ? { ...report, status, resolvedAt: new Date().toISOString() }
        : report);
    return { status: mockReports.find((report) => report.id === reportId)?.status ?? status };
  },
  adminSetEventHidden: async (eventId: string, hidden: boolean) => {
    mockReports = mockReports.map((report) => {
      if (report.event?.id !== eventId) return report;
      const resolved = hidden && report.status === "open" && report.targetType === "event";
      return {
        ...report,
        event: { ...report.event, hidden },
        ...(resolved ? { status: "resolved" as const, resolvedAt: new Date().toISOString() } : {}),
      };
    });
    return { hidden };
  },
  adminSetUserBanned: async (userId: string, banned: boolean) => {
    mockReports = mockReports.map((report) => {
      if (report.targetUser?.id !== userId) return report;
      const resolved = banned && report.status === "open";
      return {
        ...report,
        targetUser: { ...report.targetUser, banned },
        ...(resolved ? { status: "resolved" as const, resolvedAt: new Date().toISOString() } : {}),
      };
    });
    return { banned, hiddenEvents: banned ? 1 : 0 };
  },
  userCity: async (cityId?: string) => {
    const city = mockCities.find((item) => item.id === cityId);
    if (cityId && !city) throw new Error("Этот город пока недоступен.");
    if (city) mockCity = city;
    return { city: mockCity, cities: mockCities } satisfies UserCity;
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
    mockEventCategoryId = mockCategories.some((category) => category.id === payload.category)
      ? payload.category
      : null;
    return { ...cloneEventResponse(), groupAttached: payload.groupToken ? true : undefined };
  },
  saveResponse: async (_id: string, payload: any) => {
    event = applyMockResponse(event, auth.user, payload);
    return cloneEventResponse();
  },
  proposeTimeOption: async (eventId: string, startsAt: string) => {
    assertMockParticipantProposalAllowed(eventId);
    event = {
      ...event,
      timeOptions: [
        ...event.timeOptions,
        { id: `time_${Date.now()}`, startsAt, availableCount: 0 },
      ],
    };
    return cloneEventResponse();
  },
  proposePlaceOption: async (
    eventId: string,
    place: { title: string; area: string; estimatedBudget: number },
  ) => {
    assertMockParticipantProposalAllowed(eventId);
    event = {
      ...event,
      placeOptions: [
        ...event.placeOptions,
        { id: `place_${Date.now()}`, ...place },
      ],
    };
    return cloneEventResponse();
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
  meetingsPage: async (role: "owner" | "participant", cursor?: string) => {
    if (role === "participant") return { items: [], nextCursor: null };
    return cursor === "mock-owner-page-2"
      ? { items: mockOwnedMeetingPages.slice(12), nextCursor: null }
      : { items: mockOwnedMeetingPages.slice(0, 12), nextCursor: "mock-owner-page-2" };
  },
  notificationSettings: async (update?: Partial<NotificationSettings> & { writeAccessGranted?: boolean }) => {
    const { writeAccessGranted, ...preferences } = update ?? {};
    mockNotificationSettings = {
      ...mockNotificationSettings,
      ...preferences,
      ...(writeAccessGranted ? { canMessage: true } : {}),
    };
    return mockNotificationSettings;
  },
  manage: async (_id: string, payload: any) => {
    if (payload.action === "set_category") {
      if (payload.category !== null && !mockCategories.some((category) => category.id === payload.category))
        throw new Error("Эта категория недоступна.");
      mockEventCategoryId = payload.category;
    }
    if (payload.action === "update_details")
      event = {
        ...event,
        title: payload.title,
        description: payload.description,
      };
    if (payload.action === "close") event.status = "place_selection";
    if (payload.action === "reopen" && event.status !== "cancelled") event.status = "collecting";
    if (payload.action === "cancel") event.status = "cancelled";
    if (payload.action === "decide" && event.status !== "cancelled")
      event = {
        ...event,
        status: "decided",
        finalTimeOptionId: payload.finalTimeOptionId,
        finalPlaceId: payload.finalPlaceId,
      };
    return cloneEventResponse();
  },
  remove: async () => {
    eventDeleted = true;
    return { deleted: true as const };
  },
  prepareShareMessage: async () => ({ preparedMessageId: "mock-prepared-message" }),
  groupLink: async () => ({ groupLink: { chatTitle: "Друзья" } }),
  trackEvent: async () => ({ ok: true as const }),
  adminStats: async () => ({
    stats: {
      generatedAt: new Date().toISOString(),
      usersTotal: 12,
      usersNew7d: 3,
      activeToday: 4,
      active7d: 9,
      active30d: 11,
      notificationOpens7d: 5,
      meetingsTotal: 21,
      meetings7d: 6,
      responses7d: 17,
      joinRequests7d: 2,
      shares7d: 8,
      returningUsers7d: 5,
      previousWeekUsers: 8,
      meetings30d: 14,
      meetingsWithResponses30d: 11,
      daily: Array.from({ length: 14 }, (_, index) => ({
        day: new Date(Date.now() - (13 - index) * 86_400_000).toISOString().slice(0, 10),
        active: (index * 3) % 7,
        meetings: index % 3,
        responses: (index * 2) % 5,
      })),
    },
  }),
  calendarLink: async (eventId: string) => ({
    icsUrl: `https://example.test/calendar/${encodeURIComponent(eventId)}.ics?expires=0&signature=mock`,
  }),
};
