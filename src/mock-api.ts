import type {
  AuthResult,
  EventData,
  MeetingListItem,
  Participant,
} from "./types";

const future = (days: number, hour: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 30, 0, 0);
  return value.toISOString();
};
let event: EventData = {
  id: "evt_demo",
  title: "Ужин с друзьями после работы",
  description: "Выберем время и место, которые подойдут всей компании.",
  budgetLimit: 35,
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
      placeVoteCount: 1,
    },
    {
      id: "place_2",
      title: "Бистро в центре",
      area: "Октябрьская",
      estimatedBudget: 30,
      placeVoteCount: 1,
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
      selectedPlaceOptionIds: ["place_1"],
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
      selectedPlaceOptionIds: ["place_2"],
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
const listItem = (role: "owner" | "participant"): MeetingListItem => ({
  id: event.id,
  title: event.title,
  status: event.status,
  role,
  participantCount: event.participants.length,
  responseCount: event.participants.length,
  bestTime: event.timeOptions[0],
  timeSummary: event.timeOptions[0]?.startsAt ?? null,
  placeSummary: event.status === "decided" ? event.placeOptions.find((item) => item.id === event.finalPlaceId)?.title ?? null : null,
  createdAt: new Date().toISOString(),
});

export const mockApi = {
  auth: async () => clone(auth),
  event: async () => ({ event: clone(event) }),
  createEvent: async (payload: any) => {
    event = {
      ...event,
      id: `evt_${Date.now()}`,
      title: payload.title,
      description: payload.description,
      budgetLimit: payload.budgetLimit,
      timeOptions: payload.timeOptions.map(
        (startsAt: string, index: number) => ({
          id: `time_${index}`,
          startsAt,
          availableCount: 0,
        }),
      ),
      placeOptions: payload.placeOptions.map((place: any, index: number) => ({
        id: `place_${index}`,
        placeVoteCount: 0,
        ...place,
      })),
      participants: [],
      myResponse: null,
    };
    return { event: clone(event) };
  },
  saveResponse: async (_id: string, payload: any) => {
    const participant: Participant = {
      id: "person_me",
      userId: auth.user.id,
      name: auth.user.firstName,
      area: payload.area,
      budget: payload.budget,
      preferences: payload.preferences,
      restrictions: payload.restrictions,
      availableTimeOptionIds: payload.availableTimeOptionIds,
      unavailableTimeOptionIds: event.timeOptions
        .filter((time) => !payload.availableTimeOptionIds.includes(time.id))
        .map((time) => time.id),
      selectedPlaceOptionIds: payload.placeOptionIds ?? [],
    };
    event.participants = [
      ...event.participants.filter((person) => person.userId !== auth.user.id),
      participant,
    ];
    event.myResponse = participant;
    event.timeOptions = event.timeOptions.map((time) => ({
      ...time,
      availableCount: event.participants.filter((person) =>
        person.availableTimeOptionIds.includes(time.id),
      ).length,
    }));
    event.placeOptions = event.placeOptions.map((place) => ({
      ...place,
      placeVoteCount: event.participants.filter((person) => person.selectedPlaceOptionIds.includes(place.id)).length,
    }));
    return { event: clone(event) };
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
  remove: async () => ({ deleted: true as const }),
};
