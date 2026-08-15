import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canLeaveMeeting, leaveMeetingOnce } from "../src/leave-meeting";

const appSource = readFileSync("src/App.tsx", "utf8");
const apiSource = readFileSync("src/api.ts", "utf8");
const mockSource = readFileSync("src/mock-api.ts", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");
const leaveSource = appSource.slice(
  appSource.indexOf("function LeaveMeetingAction"),
  appSource.indexOf("function MyEvents"),
);
const leaveHelperSource = readFileSync("src/leave-meeting.ts", "utf8");

const participant = { id: "person_1" } as never;

describe("leave meeting visibility", () => {
  it("shows the action only for a participant who is not the owner", () => {
    expect(canLeaveMeeting({ myResponse: participant, canManage: false })).toBe(true);
    expect(canLeaveMeeting({ myResponse: participant, canManage: true })).toBe(false);
    expect(canLeaveMeeting({ myResponse: null, canManage: false })).toBe(false);
  });

  it("does not restrict the action by private/public visibility", () => {
    expect(leaveSource).toContain("function LeaveMeetingAction");
    expect(leaveSource).not.toContain("visibility");
  });
});

describe("leave meeting UI contract", () => {
  it("uses confirmation, pending disabled state, safe error and My Meetings navigation", () => {
    expect(appSource).toContain("window.confirm(");
    expect(appSource).toContain("disabled={leaving}");
    expect(appSource).toContain("navigate(\"/my-events\")");
    expect(appSource).toContain("Не удалось покинуть встречу. Попробуйте ещё раз.");
    expect(stylesSource).toContain(".danger-button {");
    expect(appSource).toContain("className=\"danger-button\"");
    expect(leaveHelperSource).toContain("event.myResponse !== null && !event.canManage");
  });

  it("renders the action on both the editable participant and result screens", () => {
    expect(appSource.match(/<LeaveMeetingAction /g)).toHaveLength(2);
    expect(appSource).toContain("canLeaveMeeting(event)");
  });

  it("calls the authenticated DELETE endpoint without identity fields", () => {
    expect(apiSource).toContain("leaveParticipation: (id: string)");
    expect(apiSource).toContain('method: "DELETE"');
    expect(apiSource).toContain("/participation");
    expect(apiSource).not.toContain("user_id");
    expect(apiSource).not.toContain("participant_id");
    expect(apiSource).not.toContain("join_request_id");
    expect(mockSource).toContain("leaveParticipation");
  });

  it("does not call the API when confirmation is cancelled", () => {
    expect(appSource).toContain("if (\n      !window.confirm(");
    expect(appSource).toContain("return;\n    setError(\"\");");
  });

  it("prevents duplicate requests while the first leave is pending", async () => {
    const lock = { current: false };
    const leave = vi.fn<(_: string) => Promise<{ left: true }>>();
    let resolve!: (value: { left: true }) => void;
    leave.mockImplementation(
      () => new Promise((next) => { resolve = next; }),
    );
    const first = leaveMeetingOnce("evt_1", lock, leave);
    const second = await leaveMeetingOnce("evt_1", lock, leave);
    expect(second).toBeNull();
    expect(leave).toHaveBeenCalledOnce();
    resolve({ left: true });
    await expect(first).resolves.toEqual({ left: true });
    expect(lock.current).toBe(false);
  });
});

describe("existing behavior remains unchanged", () => {
  it("keeps organizer deletion and public join request contracts", () => {
    expect(appSource).toContain('confirm("Удалить встречу?")');
    expect(appSource).toContain("api.remove(event.id)");
    expect(appSource).toContain("createJoinRequestOnce");
    expect(appSource).toContain("publicJoinRequestView");
  });

  it("does not touch calendar, feed or bottom navigation contracts", () => {
    expect(appSource).toContain("api.calendarLink(event.id)");
    expect(appSource).toContain("function PublicMeetings");
    expect(appSource).toContain('<BottomNavigation currentPath="/open"');
  });
});
