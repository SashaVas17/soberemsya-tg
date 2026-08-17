export type EventStatus = "collecting" | "place_selection" | "decided" | "cancelled";
export type MeetingVisibility = "private" | "public";
export type JoinRequestStatus = "none" | "pending" | "approved" | "rejected";
export type JoinRequestActionResponse = {
  joinRequestStatus: "pending" | "approved";
};

export type OrganizerJoinRequest = {
  requestId: string;
  status: "pending";
  createdAt: string;
  requester: {
    displayName: string;
    username: string | null;
  };
};

export type OrganizerJoinRequestsResponse = {
  requests: OrganizerJoinRequest[];
};

export type JoinRequestDecisionResponse = {
  requestId: string;
  status: "approved" | "rejected";
};

export type TelegramUser = {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
};

export type TimeOption = { id: string; startsAt: string; availableCount: number };
export type PlaceOption = { id: string; title: string; area: string; estimatedBudget: number };
export type OrganizerParticipant = {
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

export type SocialParticipant = {
  name: string;
  area?: string;
};

export type OwnResponse = {
  name: string;
  area: string;
  budget: number;
  preferences: string;
  restrictions: string;
  availableTimeOptionIds: string[];
  unavailableTimeOptionIds: string[];
};

type EventDataBase = {
  id: string;
  title: string;
  description: string;
  budgetLimit: number;
  visibility: MeetingVisibility;
  maxParticipants: number | null;
  status: EventStatus;
  finalPlaceId: string | null;
  finalTimeOptionId: string | null;
  timeOptions: TimeOption[];
  placeOptions: PlaceOption[];
};

export type OrganizerEventData = EventDataBase & {
  participants: OrganizerParticipant[];
  canManage: true;
  myResponse: OrganizerParticipant | null;
};

export type ParticipantEventData = EventDataBase & {
  participants: SocialParticipant[];
  canManage: false;
  myResponse: OwnResponse | null;
};

export type EventData = OrganizerEventData | ParticipantEventData;

// Internal organizer/mock state retains identifiers for request-management tests.
export type Participant = OrganizerParticipant;

export type PublicEventPreview = {
  id: string;
  visibility: "public";
  title: string;
  description: string;
  status: EventStatus;
  dateSummary: string | null;
  budgetLimit: number;
  participantCount: number;
  maxParticipants: number | null;
  joinRequestStatus: JoinRequestStatus;
};

export type PublicMeetingFeedItem = {
  id: string;
  title: string;
  description: string;
  status: "collecting";
  dateSummary: string | null;
  budgetLimit: number;
  participantCount: number;
  maxParticipants: number | null;
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
