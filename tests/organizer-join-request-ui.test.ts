import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api-error";
import {
  formatJoinRequestCreatedAt,
  formatJoinRequestUsername,
  joinRequestActionErrorMessage,
  removePendingJoinRequest,
  runOrganizerRequestActionOnce,
  shouldReloadJoinRequests,
  type OrganizerRequestActionLock,
} from "../src/organizer-request-ui";
import type { OrganizerJoinRequest } from "../src/types";

const appSource = readFileSync("src/App.tsx", "utf8");
const manageSource = appSource.slice(
  appSource.indexOf("function Manage("),
  appSource.indexOf("function Result("),
);
const componentSource = readFileSync("src/OrganizerJoinRequests.tsx", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

const request: OrganizerJoinRequest = {
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  createdAt: "2026-08-14T10:30:00.000Z",
  requester: {
    displayName: "Анна Иванова",
    username: "anna",
  },
};

function lock(): OrganizerRequestActionLock {
  return { current: new Set() };
}

function deferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("organizer join request Manage visibility", () => {
  it("does not render the request section for private Manage", () => {
    expect(manageSource).toContain('event.visibility === "public"');
    expect(manageSource).not.toContain('event.visibility === "private" && (');
  });

  it("does not render organizer requests for a public non-owner", () => {
    expect(manageSource.indexOf("if (!event.canManage)")).toBeLessThan(
      manageSource.indexOf("<OrganizerJoinRequests"),
    );
  });

  it("renders the request section for a public owner", () => {
    expect(manageSource).toContain(
      'event.visibility === "public" && event.canManage',
    );
    expect(componentSource).toContain("Заявки");
  });

  it("loads the request list once on a normal mount", () => {
    expect(componentSource).toContain("if (loadLock.current) return");
    expect(componentSource).toContain("useEffect(() =>");
    expect(componentSource).toContain("void load()");
    expect(componentSource).toContain("}, [load])");
  });

  it("keeps the loading state inside the request section", () => {
    expect(componentSource).toContain("loading && requests === null");
    expect(componentSource).toContain("Загружаем заявки…");
    expect(componentSource.indexOf("join-requests-card")).toBeLessThan(
      componentSource.indexOf("Загружаем заявки…"),
    );
  });

  it("shows the compact empty state", () => {
    expect(componentSource).toContain("Новых заявок нет");
  });
});

describe("organizer join request card contract", () => {
  it("shows requester displayName", () => {
    expect(componentSource).toContain(
      "<strong>{request.requester.displayName}</strong>",
    );
  });

  it("shows username with an at-sign when present", () => {
    expect(formatJoinRequestUsername("anna")).toBe("@anna");
    expect(formatJoinRequestUsername("@anna")).toBe("@anna");
  });

  it("omits username safely when null", () => {
    expect(formatJoinRequestUsername(null)).toBeNull();
    expect(componentSource).toContain("{username && <span>{username}</span>}");
  });

  it("renders createdAt through a safe local formatter", () => {
    expect(formatJoinRequestCreatedAt(request.createdAt)).not.toBe(
      request.createdAt,
    );
    expect(componentSource).toContain(
      "formatJoinRequestCreatedAt(request.createdAt)",
    );
  });

  it("uses a safe fallback for an invalid createdAt", () => {
    expect(formatJoinRequestCreatedAt("not-a-date")).toBe("Дата не указана");
  });

  it("does not render internal IDs as card copy", () => {
    expect(componentSource).not.toContain("{request.requestId}</");
    expect(componentSource).not.toContain("requesterUserId");
    expect(componentSource).not.toContain("telegramUserId");
    expect(componentSource).not.toContain("participantId");
  });

  it("does not render applicant personal or voting fields", () => {
    for (const field of [
      "budget",
      "area",
      "preferences",
      "restrictions",
      "availableTimeOptionIds",
      "unavailableTimeOptionIds",
    ])
      expect(componentSource).not.toContain(field);
  });

  it("shows the approve button", () => {
    expect(componentSource).toContain("Одобрить");
  });

  it("shows the reject button", () => {
    expect(componentSource).toContain("Отклонить");
  });

  it("includes compact responsive request-card styles", () => {
    expect(stylesSource).toContain(".join-request-card");
    expect(stylesSource).toContain("grid-template-columns: repeat(2");
  });
});

describe("organizer join request per-card actions", () => {
  it("calls one approve operation once", async () => {
    const action = vi.fn().mockResolvedValue({ status: "approved" });
    await runOrganizerRequestActionOnce(lock(), request.requestId, action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("calls one reject operation once", async () => {
    const action = vi.fn().mockResolvedValue({ status: "rejected" });
    await runOrganizerRequestActionOnce(lock(), request.requestId, action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("blocks a rapid duplicate approve operation", async () => {
    const gate = deferred();
    const action = vi.fn(async () => {
      await gate.promise;
      return { status: "approved" };
    });
    const actionLock = lock();
    const first = runOrganizerRequestActionOnce(
      actionLock,
      request.requestId,
      action,
    );
    const duplicate = await runOrganizerRequestActionOnce(
      actionLock,
      request.requestId,
      action,
    );
    gate.resolve();
    await first;
    expect(duplicate).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  });

  it("blocks a rapid duplicate reject operation", async () => {
    const gate = deferred();
    const action = vi.fn(async () => {
      await gate.promise;
      return { status: "rejected" };
    });
    const actionLock = lock();
    const first = runOrganizerRequestActionOnce(
      actionLock,
      request.requestId,
      action,
    );
    const duplicate = await runOrganizerRequestActionOnce(
      actionLock,
      request.requestId,
      action,
    );
    gate.resolve();
    await first;
    expect(duplicate).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  });

  it("disables both actions only on the acting card", () => {
    expect(componentSource.match(/disabled=\{acting\}/g)).toHaveLength(2);
    expect(componentSource).toContain(
      "actingRequestIds.has(request.requestId)",
    );
  });

  it("allows another card to act while one card is locked", async () => {
    const gate = deferred();
    const actionLock = lock();
    const first = runOrganizerRequestActionOnce(
      actionLock,
      "request-one",
      async () => {
        await gate.promise;
        return "first";
      },
    );
    await expect(
      runOrganizerRequestActionOnce(
        actionLock,
        "request-two",
        async () => "second",
      ),
    ).resolves.toBe("second");
    gate.resolve();
    await first;
  });

  it("removes an approved request immediately", () => {
    expect(componentSource).toContain("removePendingJoinRequest");
    expect(removePendingJoinRequest([request], request.requestId)).toEqual([]);
  });

  it("removes a rejected request immediately", () => {
    const other = { ...request, requestId: "request-two" };
    expect(removePendingJoinRequest([request, other], request.requestId)).toEqual([
      other,
    ]);
  });

  it("shows the empty state after the last card is removed", () => {
    const remaining = removePendingJoinRequest([request], request.requestId);
    expect(remaining).toHaveLength(0);
    expect(componentSource).toContain("requests?.length === 0");
  });

  it("quietly refreshes EventData only after approval", () => {
    expect(componentSource).toContain(
      'if (action === "approve") void onApproved()',
    );
    expect(manageSource).toContain("onApproved={() => state.load(true)}");
  });

  it("does not refresh EventData solely after rejection", () => {
    const approvalRefresh = componentSource.match(/void onApproved\(\)/g);
    expect(approvalRefresh).toHaveLength(1);
    expect(componentSource).not.toContain(
      'if (action === "reject") void onApproved()',
    );
  });
});

describe("organizer join request safe errors and races", () => {
  it("keeps EVENT_FULL out of stale-list reload handling", () => {
    const error = new ApiError("raw", 409, "EVENT_FULL");
    expect(shouldReloadJoinRequests(error)).toBe(false);
  });

  it("shows the safe EVENT_FULL message", () => {
    const error = new ApiError("raw", 409, "EVENT_FULL");
    expect(joinRequestActionErrorMessage(error)).toBe(
      "На встрече уже нет свободных мест",
    );
  });

  it("does not auto-reject or remove EVENT_FULL requests", () => {
    expect(componentSource).toContain("shouldReloadJoinRequests(error)");
    expect(componentSource).toContain("joinRequestActionErrorMessage(error)");
    expect(shouldReloadJoinRequests(new ApiError("raw", 409, "EVENT_FULL")))
      .toBe(false);
  });

  it("keeps JOIN_REQUESTS_CLOSED out of stale-list reload handling", () => {
    const error = new ApiError("raw", 409, "JOIN_REQUESTS_CLOSED");
    expect(shouldReloadJoinRequests(error)).toBe(false);
  });

  it("shows a safe closed-collection message", () => {
    const error = new ApiError("raw", 409, "JOIN_REQUESTS_CLOSED");
    expect(joinRequestActionErrorMessage(error)).toBe(
      "Сбор ответов уже завершён",
    );
  });

  it("keeps the card after a generic action error", () => {
    expect(joinRequestActionErrorMessage(new Error("database detail"))).toBe(
      "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
    expect(componentSource).toContain("setActionErrors");
  });

  it("never renders raw backend or database errors", () => {
    const raw = "duplicate key violates constraint participants_event_id_key";
    expect(joinRequestActionErrorMessage(new Error(raw))).not.toContain(raw);
    expect(componentSource).not.toContain("error.message");
  });

  it("isolates list failure from the Manage EventData state", () => {
    expect(componentSource).toContain("setListError(true)");
    expect(componentSource).not.toContain("setEvent(");
    expect(componentSource).not.toContain("api.event(");
  });

  it("shows list failure and a retry action", () => {
    expect(componentSource).toContain("Не удалось загрузить заявки");
    expect(componentSource).toContain("Повторить");
  });

  it("retries only the join-request list", () => {
    expect(componentSource).toContain("onClick={() => void load()}");
    expect(componentSource).toContain("api.joinRequests(eventId)");
    expect(componentSource).not.toContain("window.location.reload");
  });

  it("renders requests after a successful retry", () => {
    expect(componentSource).toContain("setRequests(result.requests)");
    expect(componentSource).toContain("setListError(false)");
  });

  it("reloads once after a safe not-pending race", () => {
    const error = new ApiError("handled", 409, "JOIN_REQUEST_NOT_PENDING");
    expect(shouldReloadJoinRequests(error)).toBe(true);
    expect(componentSource).toContain("await load()");
  });

  it("reloads once after a safe unavailable race", () => {
    expect(shouldReloadJoinRequests(new ApiError("missing", 404))).toBe(true);
    expect(componentSource).not.toContain("while (");
  });
});

describe("organizer queue lifecycle and scope", () => {
  it("does not hide pending requests for non-collecting events", () => {
    expect(componentSource).not.toContain("event.status");
    expect(manageSource).not.toContain(
      'event.status === "collecting" && event.visibility === "public"',
    );
  });

  it("keeps the queue available for cancelled public events", () => {
    expect(componentSource).not.toContain("cancelled");
    expect(manageSource).toContain('event.visibility === "public"');
  });

  it("does not implement approved or rejected history", () => {
    expect(componentSource).not.toContain("history");
    expect(componentSource).not.toContain("filter");
    expect(componentSource).not.toContain("tablist");
  });

  it("does not add a requester-side CTA to Manage", () => {
    expect(componentSource).not.toContain("Подать заявку");
    expect(componentSource).not.toContain("Присоединиться");
    expect(componentSource).not.toContain("createJoinRequest");
  });

  it("does not duplicate capacity authority in the UI", () => {
    expect(componentSource).not.toContain("maxParticipants");
    expect(componentSource).not.toContain("participantCount");
  });
});
