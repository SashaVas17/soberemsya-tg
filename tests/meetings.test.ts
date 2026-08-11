import { describe, expect, it } from "vitest";
import {
  collectVisibleMeetings,
  type MeetingRole,
} from "../supabase/functions/_shared/meetings";
import { assertEventAvailable } from "../supabase/functions/_shared/domain";
import { json } from "../supabase/functions/_shared/http";

type Item = { id: string; role: MeetingRole };

describe("meeting list visibility", () => {
  it("returns only an active participation when another participation is soft-deleted", async () => {
    const mapItem = async (eventId: string, role: MeetingRole): Promise<Item> => {
      if (eventId === "deleted") assertEventAvailable(null);
      return { id: eventId, role };
    };

    const response = json(
      await collectVisibleMeetings([], ["deleted", "active"], mapItem),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      owned: [],
      participating: [{ id: "active", role: "participant" }],
    });
  });

  it("does not return a soft-deleted owned meeting", async () => {
    const mapItem = async (eventId: string, role: MeetingRole): Promise<Item> => {
      if (eventId === "deleted-owned") assertEventAvailable(null);
      return { id: eventId, role };
    };

    await expect(
      collectVisibleMeetings(["deleted-owned"], [], mapItem),
    ).resolves.toEqual({ owned: [], participating: [] });
  });

  it("does not hide an unexpected database error", async () => {
    const databaseError = Object.assign(new Error("database unavailable"), {
      code: "XX000",
    });
    const mapItem = async (): Promise<Item> => {
      throw databaseError;
    };

    await expect(
      collectVisibleMeetings([], ["active"], mapItem),
    ).rejects.toBe(databaseError);
  });

  it("returns an empty list", async () => {
    const mapItem = async (eventId: string, role: MeetingRole): Promise<Item> =>
      ({ id: eventId, role });

    const response = json(await collectVisibleMeetings([], [], mapItem));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      owned: [],
      participating: [],
    });
  });
});
