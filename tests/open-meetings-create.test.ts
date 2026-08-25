import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEventPayload,
  validateCreateStep,
  type CreateWizardDraft,
} from "../src/create-wizard";
import { parseCreateMeetingMode } from "../supabase/functions/_shared/open-meetings";

const draft = (overrides: Partial<CreateWizardDraft> = {}): CreateWizardDraft => ({
  title: "Открытая встреча",
  description: "Тестовый сбор",
  budgetLimit: 30,
  visibility: "private",
  maxParticipants: null,
  timeOptions: ["2026-10-15T16:00:00.000Z"],
  places: [{ title: "Парк", area: "Центр", estimatedBudget: 20 }],
  ...overrides,
});

describe("Open Meetings create mode", () => {
  it("defaults the wizard to private with no capacity", () => {
    expect(draft()).toMatchObject({ visibility: "private", maxParticipants: null });
  });

  it("accepts public capacities at both valid bounds and unlimited", () => {
    expect(validateCreateStep(1, draft({ visibility: "public", maxParticipants: 2 }))).toBe("");
    expect(validateCreateStep(1, draft({ visibility: "public", maxParticipants: 50 }))).toBe("");
    expect(createEventPayload(draft({ visibility: "public", maxParticipants: null }))).toMatchObject({ visibility: "public", maxParticipants: null });
  });

  it("clears the capacity when the final mode is private", () => {
    expect(createEventPayload(draft({ visibility: "private", maxParticipants: 6 }))).toMatchObject({ visibility: "private", maxParticipants: null });
  });

  it("keeps existing create fields while adding the authoritative mode", () => {
    expect(createEventPayload(draft({ visibility: "public", maxParticipants: 6 }))).toEqual({
      title: "Открытая встреча",
      description: "Тестовый сбор",
      budgetLimit: 30,
      visibility: "public",
      maxParticipants: 6,
      timeOptions: ["2026-10-15T16:00:00.000Z"],
      placeOptions: [{ title: "Парк", area: "Центр", estimatedBudget: 20 }],
    });
  });

  it("uses private/null defaults for old clients on the server", () => {
    expect(parseCreateMeetingMode({})).toEqual({ visibility: "private", maxParticipants: null });
    expect(parseCreateMeetingMode({ visibility: "public" })).toEqual({ visibility: "public", maxParticipants: null });
  });

  it.each([
    { visibility: "unknown" },
    { visibility: "private", maxParticipants: 6 },
    { visibility: "public", maxParticipants: 1 },
    { visibility: "public", maxParticipants: 51 },
    { visibility: "public", maxParticipants: 2.5 },
    { visibility: "public", maxParticipants: "6" },
    { visibility: "public", maxParticipants: true },
    { visibility: "public", maxParticipants: Number.NaN },
  ])("strictly rejects invalid server mode %#", (payload) => {
    expect(() => parseCreateMeetingMode(payload)).toThrow();
  });

  it("keeps mock creation aligned with the production mode contract", () => {
    const source = readFileSync("src/mock-api.ts", "utf8");
    expect(source).toContain('payload.visibility === "public" ? "public" : "private"');
    expect(source).toContain("Number.isInteger(payload.maxParticipants)");
    expect(source).toContain("maxParticipants: null");
  });

  it("renders public controls and badges without changing the private UI", () => {
    const source = readFileSync("src/App.tsx", "utf8");
    const create = source.slice(source.indexOf("function CreateEvent("), source.indexOf("function useEvent("));
    expect(create).toContain("Кто сможет присоединиться?");
    expect(create).toContain("Сколько человек может быть на встрече?");
    expect(create).toContain("setMaxParticipantsInput");
    expect(create).toContain("requiredNonNegativeIntegerFromInput");
    expect(create).toContain('inputMode="numeric"');
    expect(create).toContain('type="text"');
    expect(source).toContain('event?.visibility === "public"');
    expect(source).toContain('event.visibility === "public"');
  });

  it("maps and returns the new fields in the existing event endpoint", () => {
    const source = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
    const payload = readFileSync("supabase/functions/_shared/event-payload.ts", "utf8");
    expect(source).toContain("visibility,max_participants");
    expect(payload).toContain('visibility: event.visibility === "public" ? "public" : "private"');
    expect(payload).toContain("maxParticipants: event.max_participants ?? null");
    expect(source).toContain("p_visibility: visibility");
    expect(source).toContain("p_max_participants: maxParticipants");
  });
});
