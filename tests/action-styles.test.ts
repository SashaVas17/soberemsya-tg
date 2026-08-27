import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

describe("Telegram action styling", () => {
  const buttonBlock = (label: string) => {
    const labelIndex = appSource.indexOf(label);
    const buttonIndex = appSource.lastIndexOf("<button", labelIndex);
    return appSource.slice(buttonIndex, labelIndex);
  };

  it("uses the shared semantic action tokens for primary and secondary actions", () => {
    expect(stylesSource).toContain(".primary-action {");
    expect(stylesSource).toContain("background: var(--action-primary-bg)");
    expect(stylesSource).toContain("color: var(--action-primary-fg)");
    expect(stylesSource).toContain("background: var(--action-secondary-bg)");
    expect(stylesSource).toContain("border: 1px solid var(--action-secondary-border)");
    expect(buttonBlock("Поделиться результатом")).toContain('className="primary-action share-result-action"');
    expect(buttonBlock("Отправить в чат")).toContain('className="secondary-action"');
    expect(buttonBlock("Поделиться в Telegram")).toContain('className="primary-action"');
    expect(stylesSource).not.toContain("background: var(--color-telegram)");
  });

  it("keeps secondary actions neutral and destructive actions red", () => {
    for (const label of [
      "Принять решение",
      "Закрыть сбор ответов",
      "Открыть результат",
      "Перейти к встрече",
      "Google Calendar",
      "Календарь iPhone",
    ]) {
      expect(buttonBlock(label)).toContain('className="secondary-action');
      expect(buttonBlock(label)).not.toContain("primary-action");
    }
    expect(stylesSource).toContain(".danger-button {");
    expect(stylesSource).toContain("color: var(--action-danger-fg)");
    expect(stylesSource).toContain(".primary-action:disabled,");
    expect(stylesSource).toContain("background: var(--action-disabled-bg)");
    expect(stylesSource).toContain("color: var(--action-disabled-fg)");
    expect(buttonBlock("Принять решение")).toContain("disabled={!finalTime || !finalPlace || saving}");
    expect(buttonBlock("Удалить встречу")).toContain('className="danger-button"');
  });

  it("keeps both calendar actions neutral without touching their behavior", () => {
    expect(buttonBlock("Google Calendar")).toContain('className="secondary-action calendar-action"');
    expect(buttonBlock("Календарь iPhone")).toContain('className="secondary-action calendar-action"');
    expect(appSource).toContain("googleCalendarUrl(details)");
    expect(appSource).toContain("api.calendarLink(event.id)");
  });
});
