import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const manageSource = appSource.slice(
  appSource.indexOf("function Manage("),
  appSource.indexOf("function Result("),
);
const participantSource = appSource.slice(
  appSource.indexOf("function ParticipantEvent("),
  appSource.indexOf("function Manage("),
);
const apiSource = readFileSync("src/api.ts", "utf8");
const mockSource = readFileSync("src/mock-api.ts", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

describe("organizer participant removal UI", () => {
  it("renders removal only in organizer participant details", () => {
    expect(manageSource).toContain("event.myResponse?.id !== person.id");
    expect(manageSource).toContain("Исключить из встречи");
    expect(appSource).toContain("if (!event.canManage)");
    expect(appSource).toContain("OrganizerParticipant");
    expect(participantSource).not.toContain("participant-remove-action");
  });

  it("uses a confirmation dialog with cancel and destructive confirm actions", () => {
    expect(manageSource).toContain("participantToRemove");
    expect(manageSource).toContain('aria-modal="true"');
    expect(manageSource).toContain("Исключить участника?");
    expect(manageSource).toContain("Его ответ и голоса будут удалены.");
    expect(manageSource).toContain("Отмена");
    expect(manageSource).toContain("onClick={() => void removeParticipant()}");
    expect(manageSource).toContain('className="danger-button"');
  });

  it("calls only the participant-scoped DELETE endpoint without a body", () => {
    expect(apiSource).toContain(
      "removeParticipant: (eventId: string, participantId: string)",
    );
    expect(apiSource).toContain(
      "/participants/${encodeURIComponent(participantId)}",
    );
    expect(apiSource).toContain('method: "DELETE"');
    const apiMethod = apiSource.slice(
      apiSource.indexOf("removeParticipant:"),
      apiSource.indexOf("meetings:"),
    );
    expect(apiMethod).not.toContain("body");
    expect(apiMethod).not.toContain("userId");
    expect(apiMethod).not.toContain("actorId");
    expect(apiMethod).not.toContain("joinRequestId");
  });

  it("uses per-participant pending state and refreshes the existing event", () => {
    expect(manageSource).toContain("removingParticipantId");
    expect(manageSource).toContain(
      "disabled={removingParticipantId === person.id}",
    );
    expect(manageSource).toContain("await state.load(true);");
    expect(manageSource).toContain("setParticipantToRemove(null)");
    expect(manageSource).toContain(
      "Не удалось исключить участника. Попробуйте ещё раз.",
    );
  });

  it("keeps the mock flow and existing participant privacy boundaries", () => {
    expect(mockSource).toContain(
      "removeParticipant: async (eventId: string, participantId: string)",
    );
    expect(mockSource).toContain("person.id !== participantId");
    expect(mockSource).toContain("return { removed: true as const }");
    expect(appSource).toContain("<LeaveMeetingAction");
    expect(appSource).toContain("OrganizerJoinRequests");
  });

  it("keeps destructive styling scoped and safe for mobile widths", () => {
    expect(stylesSource).toContain(".participant-remove-action {");
    expect(stylesSource).toContain(".participant-remove-backdrop {");
    expect(stylesSource).toContain(".participant-remove-dialog {");
    expect(stylesSource).toContain("env(safe-area-inset-bottom)");
    expect(stylesSource).toContain(".danger-button {");
  });
});
