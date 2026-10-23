import { nameInitial } from "./initials";
import type { Point } from "./coordinates";
import type {
  AdminReport,
  AuthResult,
  BlockedUser,
  AdminCity,
  City,
  MeetingCategory,
  MeetingListItem,
  NotificationSettings,
  PublicMeetingFeedItem,
  ReportStatus,
  UserCity,
  AdminVenue,
  MapPoints,
  VenueDraft,
  VenuePriceLevel,
  VenueStatus,
} from "./types";
import { maxPriceLevelForBudget, type VenueFilters } from "./venues";
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
  language: null,
};
const clone = <T>(value: T): T => structuredClone(value);
const MOCK_LANGUAGE_KEY = "flockly.mock.serverLanguage";
function readMockLanguage(): "ru" | "en" | null {
  try {
    const value = globalThis.sessionStorage?.getItem(MOCK_LANGUAGE_KEY);
    return value === "ru" || value === "en" ? value : null;
  } catch {
    return null;
  }
}
function writeMockLanguage(value: "ru" | "en" | null) {
  try {
    if (value) globalThis.sessionStorage?.setItem(MOCK_LANGUAGE_KEY, value);
    else globalThis.sessionStorage?.removeItem(MOCK_LANGUAGE_KEY);
  } catch {
    // Private mode: the mock forgets, as a fresh server would.
  }
}
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
  initials: event.participants.slice(0, 3).map((person) => nameInitial(person.name)),
  bestTime: event.timeOptions[0],
  upcomingTime: event.timeOptions
    .filter((option) => Date.parse(option.startsAt) >= Date.now())
    .sort((left, right) => right.availableCount - left.availableCount || left.startsAt.localeCompare(right.startsAt))[0] ?? null,
  finalTime:
    event.status === "decided"
      ? event.timeOptions.find((option) => option.id === event.finalTimeOptionId) ?? null
      : null,
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
let mockAdminCities: AdminCity[] = [
  { id: "minsk", name: "Минск", isActive: true },
  { id: "brest", name: "Брест", isActive: false },
  { id: "vitebsk", name: "Витебск", isActive: false },
  { id: "gomel", name: "Гомель", isActive: false },
  { id: "grodno", name: "Гродно", isActive: false },
  { id: "mogilev", name: "Могилёв", isActive: false },
];
// ?mockCityChoice=1: Grodno is open too and the city is not chosen yet, so the
// app asks for one on start (e2e).
const mockAsksCity = new URLSearchParams(globalThis.location?.search ?? "").has("mockCityChoice");
if (mockAsksCity) mockAdminCities = mockAdminCities.map((city) => city.id === "grodno" ? { ...city, isActive: true } : city);
let mockCityChosen = !mockAsksCity;
/** Open cities, as the user's city choice lists them. */
const openMockCities = (): City[] =>
  mockAdminCities.filter((city) => city.isActive).map(({ id, name }) => ({ id, name }));
let mockCity: City = openMockCities()[0];

// Same list as the meeting_categories migration.
const mockCategories: MeetingCategory[] = [
  { id: "coffee", name: "Кофе" },
  { id: "food", name: "Ресторан" },
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

const mockVenue = (
  id: string, categoryId: string, name: string, address: string,
  priceLevel: VenuePriceLevel | null, status: VenueStatus, extra: Partial<AdminVenue> = {},
): AdminVenue => ({
  id, categoryId, name, address, latitude: 53.9, longitude: 27.56, priceLevel,
  website: null, openingHours: null, source: "osm",
  osmUrl: `https://www.openstreetmap.org/node/${id.replace(/\D/g, "") || "1"}`,
  featured: false, status, ...extra,
});

let mockVenues: AdminVenue[] = [
  mockVenue("venue_1", "coffee", "Кофейня на Немиге", "улица Немига, 5", 1, "published", { featured: true, openingHours: "Mo-Su 08:00-22:00", latitude: 53.9045, longitude: 27.5521 }),
  mockVenue("venue_2", "bar", "Бар у Ратуши", "площадь Свободы, 2", 2, "published", { website: "https://example.com", latitude: 53.9037, longitude: 27.5562 }),
  mockVenue("venue_3", "food", "Ресторан «Старый город»", "улица Интернациональная, 21", 3, "published", { latitude: 53.9007, longitude: 27.5572 }),
  mockVenue("venue_4", "walk", "Парк Горького", "улица Фрунзе, 2", null, "published", { latitude: 53.9033, longitude: 27.5770 }),
  mockVenue("venue_5", "boardgames", "Игротека", "проспект Независимости, 40", 1, "published", { source: "manual", osmUrl: null, latitude: null, longitude: null }),
  mockVenue("venue_6", "cinema", "Кинотеатр «Центральный»", "проспект Независимости, 13", 1, "published", { latitude: 53.8986, longitude: 27.5590 }),
  mockVenue("venue_7", "bar", "Паб на Зыбицкой", "улица Зыбицкая, 6", 2, "pending"),
  mockVenue("venue_8", "coffee", "Кофе с собой", "", null, "pending"),
];

function filterMockVenues(status: VenueStatus, filters: VenueFilters = {}) {
  const search = normalizeFeedSearch(filters.q ?? "").toLocaleLowerCase("ru");
  const maxLevel = filters.budget ? maxPriceLevelForBudget(filters.budget) : null;
  return mockVenues
    .filter((venue) =>
      venue.status === status &&
      (!filters.category || venue.categoryId === filters.category) &&
      (!search || venue.name.toLocaleLowerCase("ru").includes(search)) &&
      (maxLevel === null || venue.priceLevel === null || venue.priceLevel <= maxLevel))
    .sort((left, right) => Number(right.featured) - Number(left.featured) || left.name.localeCompare(right.name, "ru"));
}

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
  // Like the real server, the mock keeps the language across reloads.
  auth: async () => ({
    ...clone(auth),
    language: readMockLanguage(),
    ...(mockCityChosen ? {} : { cityChoice: openMockCities() }),
    referralCode: "0a1b2c3d4e5f",
  }),
  saveLanguage: async (value: "ru" | "en" | null) => {
    writeMockLanguage(value);
    return { language: value };
  },
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
      cities: openMockCities(),
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
    const city = openMockCities().find((item) => item.id === cityId);
    if (cityId && !city) throw new Error("Этот город пока недоступен.");
    if (city) {
      mockCity = city;
      mockCityChosen = true;
    }
    return { city: mockCity, cities: openMockCities() } satisfies UserCity;
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
    return {
      ...cloneEventResponse(),
      groupAttached: payload.groupToken ? true : undefined,
      // «Собрать ещё раз»: the mock invites everyone of the previous meeting but the organizer.
      repeatInvited: payload.repeatOf ? 2 : undefined,
    };
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
      referrals: {
        invited7d: 2,
        invited30d: 5,
        topInviters: [
          { name: "Анна", username: "anna", invited: 3 },
          { name: "Илья", username: null, invited: 2 },
        ],
      },
    },
  }),
  venues: async (filters?: VenueFilters, offset = 0) => ({
    items: clone(filterMockVenues("published", filters).slice(offset, offset + 30))
      .map(({ status, ...venue }) => { void status; return venue; }),
    nextOffset: null,
    city: clone(mockCity),
    categories: mockCategories,
  }),
  venue: async (venueId: string) => {
    const found = mockVenues.find((venue) => venue.id === venueId && venue.status === "published");
    if (!found) throw new Error("Место не найдено.");
    const { status, ...venue } = clone(found);
    void status;
    return { venue };
  },
  mapPoints: async (category?: string | null): Promise<MapPoints> => ({
    venues: filterMockVenues("published", { category })
      .filter((venue) => venue.latitude !== null && venue.longitude !== null)
      .map((venue) => [venue.id, venue.latitude ?? 0, venue.longitude ?? 0, venue.categoryId, venue.featured]),
    meetings: !category || category === mockEventCategoryId ? [{
      id: event.id,
      title: event.title,
      categoryId: mockEventCategoryId,
      latitude: 53.9037,
      longitude: 27.5562,
      venueName: "Бар у Ратуши",
      startsAt: event.timeOptions[0]?.startsAt ?? null,
    }] : [],
    city: clone(mockCity),
    bounds: { south: 53.8, west: 27.37, north: 53.99, east: 27.76 },
    categories: mockCategories,
  }),
  adminVenues: async (status: VenueStatus, filters?: VenueFilters, offset = 0, cityId?: string | null) => ({
    items: clone(filterMockVenues(status, filters).slice(offset, offset + 30)),
    nextOffset: null,
    city: clone(mockAdminCities.find((city) => city.id === (cityId ?? mockCity.id)) ?? mockAdminCities[0]),
    cities: clone(mockAdminCities),
    categories: mockCategories,
    importCategories: mockCategories.filter((category) => category.id !== "other").map((category) => category.id),
  }),
  adminCreateVenue: async (draft: VenueDraft, point: Point | null = null) => {
    const venueId = `venue_${mockVenues.length + 1}`;
    mockVenues = [...mockVenues, mockVenue(venueId, draft.categoryId, draft.name, draft.address, draft.priceLevel, "published", {
      source: "manual", osmUrl: null, website: draft.website || null,
      latitude: point?.latitude ?? null, longitude: point?.longitude ?? null,
    })];
    return { venueId };
  },
  adminSetVenuePoint: async (venueId: string, point: Point | null) => {
    mockVenues = mockVenues.map((venue) => venue.id === venueId && venue.source === "manual"
      ? { ...venue, latitude: point?.latitude ?? null, longitude: point?.longitude ?? null }
      : venue);
    return { updated: true as const };
  },
  adminUpdateVenue: async (
    venueId: string,
    update: { status: VenueStatus; categoryId: string; priceLevel: VenuePriceLevel | null; featured: boolean },
  ) => {
    mockVenues = mockVenues.map((venue) => venue.id === venueId ? { ...venue, ...update } : venue);
    return { updated: true as const };
  },
  adminPublishVenues: async (ids: string[]) => {
    let published = 0;
    mockVenues = mockVenues.map((venue) => {
      if (!ids.includes(venue.id) || venue.status !== "pending") return venue;
      published += 1;
      return { ...venue, status: "published" as const };
    });
    return { published };
  },
  adminSetCityActive: async (cityId: string, isActive: boolean) => {
    mockAdminCities = mockAdminCities.map((city) => city.id === cityId ? { ...city, isActive } : city);
    return { cities: clone(mockAdminCities) };
  },
  adminImportVenues: async (categoryId: string) => {
    void categoryId;
    return { found: 0, inserted: 0, updated: 0, truncated: false };
  },
  calendarLink: async (eventId: string) => ({
    icsUrl: `https://example.test/calendar/${encodeURIComponent(eventId)}.ics?expires=0&signature=mock`,
  }),
};
