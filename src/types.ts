export type EventStatus = "collecting" | "place_selection" | "decided" | "cancelled";

export type TelegramUser = {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
};

export type TimeOption = { id: string; startsAt: string; availableCount: number };
export type PlaceOption = {
  id: string;
  title: string;
  area: string;
  estimatedBudget: number;
  placeVoteCount: number;
};
export type Participant = {
  id: string;
  userId: string | null;
  name: string;
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
  availableTimeOptionIds: string[];
  unavailableTimeOptionIds: string[];
  selectedPlaceOptionIds: string[];
};

export type EventData = {
  id: string;
  title: string;
  description: string;
  budgetLimit: number;
  status: EventStatus;
  finalPlaceId: string | null;
  finalTimeOptionId: string | null;
  timeOptions: TimeOption[];
  placeOptions: PlaceOption[];
  participants: Participant[];
  canManage: boolean;
  myResponse: Participant | null;
};

export type MeetingListItem = {
  id: string;
  title: string;
  status: EventStatus;
  role: "owner" | "participant";
  participantCount: number;
  responseCount: number;
  bestTime: TimeOption | null;
  timeSummary: string | null;
  placeSummary: string | null;
  createdAt: string;
};

export type AuthResult = { user: TelegramUser; startParam: string | null };
