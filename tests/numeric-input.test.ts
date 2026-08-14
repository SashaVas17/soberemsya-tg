import { describe, expect, it } from "vitest";
import {
  nonNegativeIntegerFromInput,
  normalizeNumericInput,
  requiredNonNegativeIntegerFromInput,
} from "../src/numeric-input";
import {
  validateCreateStep,
  type CreateWizardDraft,
} from "../src/create-wizard";

function publicDraft(maxParticipants: number | null): CreateWizardDraft {
  return {
    title: "Открытая встреча",
    description: "",
    budgetLimit: 0,
    visibility: "public",
    maxParticipants,
    timeOptions: [],
    places: [],
  };
}

describe("editable numeric inputs", () => {
  it("allows a budget to be cleared and entered as 30 without a leading zero", () => {
    let budget = normalizeNumericInput("");
    budget = normalizeNumericInput(`${budget}3`);
    budget = normalizeNumericInput(`${budget}0`);

    expect(budget).toBe("30");
    expect(nonNegativeIntegerFromInput(budget)).toBe(30);
  });

  it("allows a participant limit to be cleared and entered directly", () => {
    expect(normalizeNumericInput("")).toBe("");
    expect(requiredNonNegativeIntegerFromInput("6")).toBe(6);
  });

  it("keeps the existing public participant limit validation", () => {
    expect(validateCreateStep(1, publicDraft(Number.NaN))).toContain("от 2 до 50");
    expect(validateCreateStep(1, publicDraft(1))).toContain("от 2 до 50");
    expect(validateCreateStep(1, publicDraft(51))).toContain("от 2 до 50");
    expect(validateCreateStep(1, publicDraft(6))).toBe("");
  });
});
