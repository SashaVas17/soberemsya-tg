import { describe, expect, it } from "vitest";
import { slotVotes } from "../src/slot-votes";

const slots = (...counts: number[]) => counts.map((availableCount, index) => ({ id: `s${index}`, startsAt: `2026-10-2${index}T18:00:00Z`, availableCount }));
const people = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `P${index}` }));
const mine = (ids: string[]) => ({ availableTimeOptionIds: ids, unavailableTimeOptionIds: [] }) as never;

describe("slot votes", () => {
  it("counts saved answers and marks the one slot ahead", () => {
    const votes = slotVotes({ timeOptions: slots(3, 2), participants: people(4), myResponse: null }, []);
    expect(votes.total).toBe(4);
    expect([votes.count("s0"), votes.count("s1")]).toEqual([3, 2]);
    expect([votes.leading("s0"), votes.leading("s1")]).toEqual([true, false]);
  });

  it("marks every slot sharing the lead, and none when all tie or nobody fits", () => {
    const tie = slotVotes({ timeOptions: slots(3, 3, 1), participants: people(4), myResponse: null }, []);
    expect([tie.leading("s0"), tie.leading("s1"), tie.leading("s2")]).toEqual([true, true, false]);
    const flat = slotVotes({ timeOptions: slots(2, 2), participants: people(3), myResponse: null }, []);
    expect([flat.leading("s0"), flat.leading("s1")]).toEqual([false, false]);
    const none = slotVotes({ timeOptions: slots(0, 0), participants: people(1), myResponse: null }, []);
    expect(none.leading("s0")).toBe(false);
  });

  it("swaps this person's saved choice for the one on screen", () => {
    // Saved: s0. On screen: s1 instead.
    const votes = slotVotes({ timeOptions: slots(3, 1), participants: people(3), myResponse: mine(["s0"]) }, ["s1"]);
    expect(votes.total).toBe(3);
    expect([votes.count("s0"), votes.count("s1")]).toEqual([2, 2]);
  });

  it("counts a first answer once something is ticked", () => {
    const empty = slotVotes({ timeOptions: slots(1), participants: people(2), myResponse: null }, []);
    expect(empty.total).toBe(2);
    const ticked = slotVotes({ timeOptions: slots(1), participants: people(2), myResponse: null }, ["s0"]);
    expect(ticked.total).toBe(3);
    expect(ticked.count("s0")).toBe(2);
  });
});
