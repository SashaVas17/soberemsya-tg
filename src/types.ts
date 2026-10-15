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
  selectedPlaceOptionIds?: string[];
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
  category?: MeetingCategory | null;
  timeOptions: TimeOption[];
  placeOptions: PlaceOption[];
};

export type OrganizerEventData = EventDataBase & {
  participants: OrganizerParticipant[];
  canManage: true;
  myResponse: OrganizerParticipant | null;
  /** The administrator took the meeting off the open feed. */
  hiddenByModerator?: boolean;
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
  category?: MeetingCategory | null;
};

export type City = {
  id: string;
  name: string;
};

/** A city in «Каталог мест»: closed cities are listed too, their catalog is filled before they open. */
export type AdminCity = City & { isActive: boolean };

export type MeetingCategory = {
  id: string;
  name: string;
};

/** The viewer's city and the cities that can be chosen. */
export type UserCity = {
  city: City;
  cities: City[];
};

export type PublicMeetingFeedPage = {
  items: PublicMeetingFeedItem[];
  nextCursor: string | null;
  city?: City;
  cities?: City[];
  categories?: MeetingCategory[];
  /** Whether the viewer has seen the community rules (stage 2.4). */
  communityRulesAccepted?: boolean;
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
  category?: MeetingCategory | null;
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

// language: the choice saved on the server; null — «as in Telegram».
export type AuthResult = { user: TelegramUser; startParam: string | null; isAdmin?: boolean; language?: "ru" | "en" | null };

export type AdminStats = {
  generatedAt: string;
  usersTotal: number;
  usersNew7d: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  notificationOpens7d: number;
  meetingsTotal: number;
  meetings7d: number;
  responses7d: number;
  joinRequests7d: number;
  shares7d: number;
  returningUsers7d: number;
  previousWeekUsers: number;
  meetings30d: number;
  meetingsWithResponses30d: number;
  daily: { day: string; active: number; meetings: number; responses: number }[];
};

export type NotificationResponseMode = "summary" | "each" | "off";

export type NotificationSettings = {
  responseMode: NotificationResponseMode;
  reminder24h: boolean;
  reminder2h: boolean;
  canMessage: boolean | null;
};

export type BlockedUser = {
  userId: string;
  name: string;
  username: string | null;
  blockedAt: string;
};

export type ReportStatus = "open" | "resolved" | "dismissed";

/** A report as the administrator sees it. */
export type AdminReport = {
  id: string;
  status: ReportStatus;
  targetType: "event" | "user";
  reason: string;
  comment: string;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { name: string | null; username: string | null };
  event: {
    id: string;
    title: string;
    status: EventStatus;
    visibility: MeetingVisibility;
    hidden: boolean;
    deleted: boolean;
  } | null;
  targetUser: {
    id: string;
    name: string | null;
    username: string | null;
    banned: boolean;
  } | null;
  openReportsOnTarget: number;
};

/** Price per person: 1 — до 20 BYN, 2 — 20–50 BYN, 3 — от 50 BYN (stage 2.3). */
export type VenuePriceLevel = 1 | 2 | 3;
export type VenueStatus = "pending" | "published" | "hidden";

export type Venue = {
  id: string;
  categoryId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  priceLevel: VenuePriceLevel | null;
  website: string | null;
  openingHours: string | null;
  source: "osm" | "manual";
  /** The object on openstreetmap.org for imported venues. */
  osmUrl: string | null;
  featured: boolean;
};

export type AdminVenue = Venue & { status: VenueStatus };

export type VenuePage = {
  items: Venue[];
  nextOffset: number | null;
  city?: City;
  categories?: MeetingCategory[];
};

export type AdminVenuePage = {
  items: AdminVenue[];
  nextOffset: number | null;
  city?: AdminCity;
  cities?: AdminCity[];
  categories?: MeetingCategory[];
  /** Categories that can be imported from OpenStreetMap. */
  importCategories?: string[];
  /** Overpass servers and a query per category; null — no import for this city. */
  overpass?: { urls: string[]; queries: Record<string, string> } | null;
};

export type VenueImportResult = {
  found: number;
  inserted: number;
  updated: number;
  /** Overpass hit its output limit: some venues may be missing. */
  truncated?: boolean;
};

export type VenueDraft = {
  categoryId: string;
  name: string;
  address: string;
  priceLevel: VenuePriceLevel | null;
  website: string;
};

/** A venue on the map: [id, latitude, longitude, categoryId, featured]. */
export type MapVenuePoint = [string, number, number, string, boolean];

/** An open meeting on the map, placed at its catalogue venue. */
export type MapMeeting = {
  id: string;
  title: string;
  categoryId: string | null;
  latitude: number;
  longitude: number;
  venueName: string;
  startsAt: string | null;
};

export type MapBounds = { south: number; west: number; north: number; east: number };

export type MapPoints = {
  venues: MapVenuePoint[];
  meetings: MapMeeting[];
  city?: City;
  bounds: MapBounds;
  categories?: MeetingCategory[];
};
