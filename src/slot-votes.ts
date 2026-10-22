import type { EventData } from "./types";

export type SlotVotes = {
  /** People who answered, counting this person once their choice is not empty. */
  total: number;
  count: (slotId: string) => number;
  /** A slot ahead of the others; none when nobody fits or every slot ties. */
  leading: (slotId: string) => boolean;
};

/**
 * Saved answers per time option, with this person's saved choice swapped for
 * the one on screen, so the tally moves as they tick and untick.
 */
export function slotVotes(
  event: Pick<EventData, "timeOptions" | "participants" | "myResponse">,
  available: string[],
): SlotVotes {
  const saved = new Set(event.myResponse?.availableTimeOptionIds ?? []);
  const chosen = new Set(available);
  const counts = new Map(
    event.timeOptions.map((slot) => [
      slot.id,
      Math.max(0, slot.availableCount - (saved.has(slot.id) ? 1 : 0)) + (chosen.has(slot.id) ? 1 : 0),
    ]),
  );
  const total = event.participants.length + (!event.myResponse && chosen.size > 0 ? 1 : 0);
  const max = Math.max(0, ...counts.values());
  const leaders = [...counts].filter(([, count]) => count === max).length;
  const someoneAhead = max > 0 && leaders < counts.size;
  return {
    total,
    count: (slotId) => Math.min(counts.get(slotId) ?? 0, total),
    leading: (slotId) => someoneAhead && counts.get(slotId) === max,
  };
}
