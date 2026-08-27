import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  addTimeOption,
  advanceCreateStep,
  createdEventPath,
  createEventPayload,
  createTimeOption,
  previousCreateStep,
  removeTimeOption,
  submitCreateEventOnce,
  validateCreateStep,
  type CreateWizardDraft,
} from "../src/create-wizard";

const firstTime = "2026-10-15T16:00:00.000Z";
const secondTime = "2026-10-16T15:30:00.000Z";

function draft(overrides: Partial<CreateWizardDraft> = {}): CreateWizardDraft {
  return {
    title: "Шашлыки с друзьями",
    description: "Встречаемся после работы",
    budgetLimit: 45,
    visibility: "private",
    maxParticipants: null,
    timeOptions: [firstTime],
    places: [
      { title: "Парк", area: "Немига", estimatedBudget: 35 },
      { title: "Публика", area: "Октябрьская", estimatedBudget: 50 },
    ],
    ...overrides,
  };
}

describe("create meeting wizard", () => {
  it("requires a title on Step 1", () => {
    expect(validateCreateStep(1, draft({ title: "  " }))).toBe(
      "Введите название встречи.",
    );
  });

  it("moves from Step 1 to Step 2 with a valid title", () => {
    expect(advanceCreateStep(1, draft())).toEqual({ error: "", step: 2 });
  });

  it("requires at least one valid time option on Step 2", () => {
    expect(validateCreateStep(2, draft({ timeOptions: [] }))).not.toBe("");
    expect(
      validateCreateStep(2, draft({ timeOptions: ["not-a-date"] })),
    ).not.toBe("");
  });

  it("adds multiple unique time options", () => {
    const withSecond = addTimeOption([firstTime], secondTime);
    expect(withSecond).toEqual([firstTime, secondTime]);
    expect(addTimeOption(withSecond, secondTime)).toBe(withSecond);
  });

  it("creates a time option only from an explicit date and time confirmation", () => {
    const selected = createTimeOption("2026-10-20", "19:45");
    expect(selected).not.toBeNull();
    const localValue = new Date(selected!);
    expect(localValue.getFullYear()).toBe(2026);
    expect(localValue.getMonth()).toBe(9);
    expect(localValue.getDate()).toBe(20);
    expect(localValue.getHours()).toBe(19);
    expect(localValue.getMinutes()).toBe(45);
    expect(createTimeOption("", "18:30")).toBeNull();
    expect(createTimeOption("2026-10-20", "25:00")).toBeNull();
  });

  it("removes one time option without changing the others", () => {
    expect(removeTimeOption([firstTime, secondTime], firstTime)).toEqual([
      secondTime,
    ]);
  });

  it("moves from Step 2 to Step 3", () => {
    expect(advanceCreateStep(2, draft())).toEqual({ error: "", step: 3 });
  });

  it("moves back 3 → 2 and 2 → 1", () => {
    expect(previousCreateStep(3)).toBe(2);
    expect(previousCreateStep(2)).toBe(1);
  });

  it("does not mutate form data while moving between steps", () => {
    const form = draft();
    const snapshot = structuredClone(form);
    advanceCreateStep(1, form);
    advanceCreateStep(2, form);
    previousCreateStep(3);
    expect(form).toEqual(snapshot);
  });

  it("preserves all existing place and budget fields in the payload", () => {
    expect(createEventPayload(draft())).toMatchObject({
      budgetLimit: 45,
      placeOptions: [
        { title: "Парк", area: "Немига", estimatedBudget: 35 },
        { title: "Публика", area: "Октябрьская", estimatedBudget: 50 },
      ],
    });
  });

  it("builds exactly the existing create payload", () => {
    expect(createEventPayload(draft())).toEqual({
      title: "Шашлыки с друзьями",
      description: "Встречаемся после работы",
      budgetLimit: 45,
      visibility: "private",
      maxParticipants: null,
      timeOptions: [firstTime],
      placeOptions: [
        { title: "Парк", area: "Немига", estimatedBudget: 35 },
        { title: "Публика", area: "Октябрьская", estimatedBudget: 50 },
      ],
    });
  });

  it("performs only one create request while a submission is in flight", async () => {
    let finish!: (value: { event: { id: string } }) => void;
    const createEvent = vi.fn(
      () =>
        new Promise<{ event: { id: string } }>((resolve) => {
          finish = resolve;
        }),
    );
    const lock = { current: false };

    const first = submitCreateEventOnce(draft(), lock, createEvent);
    const second = submitCreateEventOnce(draft(), lock, createEvent);

    expect(createEvent).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBeNull();
    finish({ event: { id: "evt_real" } });
    await expect(first).resolves.toEqual({ event: { id: "evt_real" } });
  });

  it("uses the real event id in the unchanged success route", () => {
    expect(createdEventPath("evt_real_from_api")).toBe(
      "/created/evt_real_from_api",
    );
  });
});

describe("create screen boundaries", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const createSource = appSource.slice(
    appSource.indexOf("function CreateEvent("),
    appSource.indexOf("function useEvent("),
  );
  const slotBuilderSource = appSource.slice(
    appSource.indexOf("function SlotBuilder("),
    appSource.indexOf("function CreateEvent("),
  );

  it("does not render BottomNavigation on any create step", () => {
    expect(createSource).not.toContain("<BottomNavigation");
  });

  it("keeps wizard state independent from theme changes", () => {
    expect(createSource).not.toContain("resolvedTheme");
    expect(createSource).not.toContain("key={resolvedTheme}");
    expect(createSource).toContain("const [step, setStep] = useState(1)");
  });

  it("keeps Telegram BackButton override and the existing create API", () => {
    expect(createSource).toContain("setBackOverride");
    expect(createSource).toContain("api.createEvent");
    expect(createSource).toContain("createdEventPath(result.event.id)");
  });

  it("renders compact time option cards with real inputs and a separate add action", () => {
    expect(slotBuilderSource).toContain('className="slot-option-card"');
    expect(slotBuilderSource).toContain('type="date"');
    expect(slotBuilderSource).toContain('type="time"');
    expect(slotBuilderSource).toContain('className="secondary-action slot-add-action"');
    expect(slotBuilderSource).toContain("setPickerOpen(true)");
    expect(slotBuilderSource).toContain("onClick={confirmPicker}");
    expect(slotBuilderSource).toContain("onClick={() => setPickerOpen(false)}");
    expect(slotBuilderSource).not.toContain('className="slot-controls"');
  });

  it("does not mutate draft time options while opening the picker", () => {
    const addButton = slotBuilderSource.slice(
      slotBuilderSource.indexOf('className="secondary-action slot-add-action"'),
      slotBuilderSource.indexOf("{pickerOpen && (")
    );
    expect(addButton).toContain("onClick={openPicker}");
    expect(addButton).not.toContain("onChange(");
    expect(addButton).not.toContain("addTimeOption(");
  });

  it("keeps Step 2 controls inside narrow mobile viewports", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toContain("width: min(100%, 430px)");
    expect(styles).toContain("env(safe-area-inset-left)");
    expect(styles).toContain("env(safe-area-inset-right)");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(styles).toContain("gap: 12px;");
  });

  it("constrains native date and time controls in both Step 2 contexts", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    for (const selector of [
      ".time-picker-dialog input[type=\"date\"]",
      ".time-picker-dialog input[type=\"time\"]",
      ".slot-option-card input[type=\"date\"]",
      ".slot-option-card input[type=\"time\"]",
    ]) {
      expect(styles).toContain(selector);
    }
    expect(styles).toContain(".time-picker-dialog .field {");
    expect(styles).toContain(".slot-option-card .field {");
    expect(styles).toContain("box-sizing: border-box;");
    expect(styles).toContain("max-width: 100%;");
    expect(styles).toContain("min-width: 0;");
  });

  it("keeps the Step 2 back route in Telegram and removes its screen back button", () => {
    expect(createSource).toContain("previousCreateStep(current)");
    expect(createSource).toContain("{step === 3 && (");
    expect(createSource).toContain('className={`wizard-actions${step === 2 ? " step-2-actions" : ""}`}');
  });

  it("keeps the unchanged Step 2 Continue action and timeOptions payload", () => {
    expect(createSource).toContain('step < 3 ? "Продолжить"');
    expect(createEventPayload(draft()).timeOptions).toEqual([firstTime]);
  });

  it("blocks Step 2 progression until a valid time exists", () => {
    expect(createSource).toContain("hasValidTimeOption");
    expect(createSource).toContain("Добавьте хотя бы один вариант даты и времени, чтобы продолжить.");
    expect(createSource).toContain("disabled={saving || (step === 2 && !hasValidTimeOption)}");
  });

  it("keeps optional places behind an explicit add action", () => {
    expect(createSource).toContain("useState<EditablePlaceDraft[]>([])");
    expect(createSource).toContain('className="add-place-action"');
    expect(createSource).toContain("Места необязательны.");
    expect(createSource).toContain("Бюджет этого места, BYN");
    expect(createSource).toContain("Общий бюджет встречи, BYN");
    expect(createSource).toContain("places.length > 0");
  });
});
