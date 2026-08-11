export type MeetingRole = "owner" | "participant";

function isUnavailableEvent(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EVENT_UNAVAILABLE",
  );
}

async function collectVisible<T extends object>(
  eventIds: string[],
  role: MeetingRole,
  mapItem: (eventId: string, role: MeetingRole) => Promise<T>,
) {
  const items = await Promise.all(
    eventIds.map(async (eventId) => {
      try {
        return await mapItem(eventId, role);
      } catch (error) {
        if (isUnavailableEvent(error)) return null;
        throw error;
      }
    }),
  );
  return items.filter((item): item is Awaited<T> => item !== null);
}

export async function collectVisibleMeetings<T extends object>(
  ownedIds: string[],
  participatingIds: string[],
  mapItem: (eventId: string, role: MeetingRole) => Promise<T>,
) {
  const [owned, participating] = await Promise.all([
    collectVisible(ownedIds, "owner", mapItem),
    collectVisible(participatingIds, "participant", mapItem),
  ]);
  return { owned, participating };
}
