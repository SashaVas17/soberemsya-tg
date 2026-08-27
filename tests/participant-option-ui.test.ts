import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const api = readFileSync("src/api.ts", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const tokens = readFileSync("src/design-tokens.css", "utf8");
const participant = app.slice(
  app.indexOf("function ParticipantEvent("),
  app.indexOf("function LeaveMeetingAction("),
);
const create = app.slice(
  app.indexOf("function CreateEvent("),
  app.indexOf("function useEvent("),
);

describe("participant option UX", () => {
  it("renders exactly one checked create privacy indicator", () => {
    expect(create).toContain('{visibility === "private" && <Check size={16} />}');
    expect(create).toContain('{visibility === "public" && <Check size={16} />}');
    expect(create).toContain('aria-pressed={visibility === "private"}');
    expect(create).toContain('aria-pressed={visibility === "public"}');
  });

  it("uses one semantic selected indicator treatment for time and place", () => {
    expect(tokens).toContain("--selection-indicator-selected-fg: var(--color-on-primary-soft)");
    expect(styles).toContain(".availability-card > span:not(.availability-check)");
    expect(styles).toContain(".availability-card.available .availability-check {");
    expect(styles).toContain("color: var(--selection-indicator-selected-fg);");
    expect(participant).toContain('className={`availability-card ${can ? "available" : ""}`}');
    expect(participant).toContain('className={`availability-card ${selected ? "available" : ""}`}');
  });

  it("uses the released v39 proposal routes and consumes their event payloads", () => {
    expect(api).toContain("/time-options/proposals");
    expect(api).toContain("JSON.stringify({ startsAt })");
    expect(api).toContain("/place-options/proposals");
    expect(api).toContain("JSON.stringify({ place })");
    expect(app).toContain("const result = await api.proposeTimeOption(eventId, startsAt)");
    expect(app).toContain("const result = await api.proposePlaceOption(eventId, {");
    expect(app).toContain("onProposed(result.event)");
  });

  it("keeps participant proposal controls lifecycle- and role-scoped", () => {
    expect(participant).toContain('const canProposeOptions = !event.canManage && event.status === "collecting"');
    expect(participant).toContain("<ParticipantTimeProposal");
    expect(participant).toContain("<ParticipantPlaceProposal");
    expect(participant).not.toContain("person.userId");
    expect(participant).not.toContain("person.id");
  });

  it("saves time and place selections through the same response mutation", () => {
    expect(participant).toContain("selectedPlaceOptionIds: selectedPlaces");
    expect(participant).toContain("setSelectedPlaces(draft.selectedPlaceOptionIds)");
    expect(participant).toContain("saveResponseOnce(");
    expect(participant).not.toContain("place-votes");
  });
});
