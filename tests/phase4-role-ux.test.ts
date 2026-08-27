import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const manageSource = appSource.slice(
  appSource.indexOf("function Manage("),
  appSource.indexOf("function Result("),
);
const participantSource = appSource.slice(
  appSource.indexOf("function ParticipantEvent("),
  appSource.indexOf("function LeaveMeetingAction("),
);
const previewSource = appSource.slice(
  appSource.indexOf("function PublicPreviewScreen("),
  appSource.indexOf("function ParticipantEvent("),
);
const stylesSource = readFileSync("src/styles.css", "utf8");

describe("Phase 4 role and management UX contracts", () => {
  it("keeps the organizer workflow sections and next-action hierarchy", () => {
    for (const section of [
      "manage-next-action",
      "manage-details-card",
      "manage-time-card",
      "manage-places-card",
      "manage-participants-card",
      "decision-panel",
      "manage-danger-zone",
    ]) {
      expect(manageSource).toContain(section);
    }
    expect(manageSource).toContain('className="primary-action"');
    expect(manageSource).toContain("Принять решение");
    expect(manageSource).toContain("managePayloads.reopen");
    expect(manageSource).toContain("managePayloads.close");
    expect(manageSource).toContain("api.remove(event.id)");
  });

  it("keeps removal and participant controls discoverable without changing their handlers", () => {
    expect(manageSource).toContain('aria-label="Удалить вариант времени"');
    expect(manageSource).toContain('aria-label="Удалить вариант места"');
    expect(manageSource).toContain("managePayloads.removeTime(");
    expect(manageSource).toContain("managePayloads.removePlace(item.id)");
    expect(manageSource).toContain("api.removeParticipant(eventId, participantId)");
  });

  it("keeps participant response, leave, and safe role messaging", () => {
    expect(participantSource).toContain("participant-next-action");
    expect(participantSource).toContain("saveResponseOnce");
    expect(participantSource).toContain("Отправить ответ");
    expect(participantSource).toContain("LeaveMeetingAction");
    expect(participantSource).not.toContain("person.id");
    expect(participantSource).not.toContain("person.userId");
  });

  it("keeps public strangers on the safe preview and makes the join action primary", () => {
    expect(previewSource).toContain("public-preview-details");
    expect(previewSource).toContain("requestView.actionLabel");
    expect(previewSource).toContain('className="primary-action public-preview-join-action"');
    expect(previewSource).not.toContain("timeOptions");
    expect(previewSource).not.toContain("placeOptions");
    expect(previewSource).not.toContain("participants");
  });

  it("keeps the shared theme/action system and mobile touch targets", () => {
    expect(stylesSource).toContain(".manage-next-action {");
    expect(stylesSource).toContain(".manage-danger-zone {");
    expect(stylesSource).toContain(".participant-next-action {");
    expect(stylesSource).toContain(".public-preview-join-action {");
    expect(stylesSource).toContain("min-height: 44px;");
    expect(stylesSource).toContain("var(--action-primary-bg)");
    expect(stylesSource).toContain("var(--action-danger-fg)");
  });
});
