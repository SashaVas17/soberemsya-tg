import { expect, test } from "@playwright/test";

// Smoke flows against the mock API and mock Telegram (no network, no database).
test.beforeEach(async ({ page }) => {
  await page.route("**/telegram-web-app.js*", (route) => route.abort());
});

test("organizer creates a meeting and lands on its management screen", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Создать встречу/ }).click();
  await page.getByLabel("Название встречи").fill("E2E шашлыки");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Добавить время" }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Создать встречу" }).click();

  await expect(page.getByText("Встреча создана 🎉")).toBeVisible();
  await expect(page.getByText(/startapp=event_evt_/)).toBeVisible();
  await page.getByRole("button", { name: "Перейти к встрече" }).click();
  await expect(page).toHaveURL(/#\/manage\/evt_/);
  await expect(page.getByText("E2E шашлыки").first()).toBeVisible();
});

test("participant answers with an available time", async ({ page }) => {
  await page.goto("./#/event/evt_demo");
  // Mock dates are relative to today, so pick the first time option by position.
  await page.getByRole("button", { name: /Подходит/ }).first().click();
  await page.getByRole("button", { name: "Отправить ответ" }).click();

  await expect(page.getByText("Ваш ответ сохранён", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Изменить мой ответ" })).toBeVisible();
});

test("organizer picks the final time and place and opens the result", async ({ page }) => {
  await page.goto("./#/manage/evt_demo");
  const decide = page.getByRole("button", { name: "Принять решение" });
  await expect(decide).toBeDisabled();
  const finalSelect = (placeholder: string) =>
    page.locator("select", { has: page.locator("option", { hasText: placeholder }) });
  await finalSelect("Выберите время").selectOption({ index: 1 });
  await finalSelect("Выберите место").selectOption({ label: "Кафе у Ратуши · Немига" });
  await decide.click();
  await page.getByRole("button", { name: "Открыть результат" }).click();

  await expect(page).toHaveURL(/#\/result\/evt_demo/);
  await expect(page.getByText("Кафе у Ратуши").first()).toBeVisible();
});

test("user changes notification settings", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Уведомления от бота" }).click();
  await expect(page).toHaveURL(/#\/settings/);
  const each = page.getByRole("button", { name: /Каждый новый ответ/ });
  await each.click();
  await expect(each).toHaveAttribute("aria-pressed", "true");
  const reminder = page.getByLabel("За 2 часа");
  await reminder.uncheck();
  await expect(reminder).not.toBeChecked();
});

test("organizer cancels a meeting", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("./#/manage/evt_demo");
  await page.getByRole("button", { name: "Отменить встречу" }).click();
  await expect(page.getByText("Встреча отменена").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Отменить встречу" })).toHaveCount(0);
});

test("organizer creates a meeting from a group chat link", async ({ page }) => {
  await page.goto("./?mockStartParam=group_AbCdEfGhIjKlMnOpQrStUv_-");
  await expect(page.getByText("Встреча для чата «Друзья»")).toBeVisible();
  await page.getByLabel("Название встречи").fill("E2E в группе");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Добавить время" }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Создать встречу" }).click();

  await expect(page.getByText("Карточка встречи появится в чате «Друзья» в течение минуты.")).toBeVisible();
});

test("administrator opens the statistics screen", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Статистика" }).click();
  await expect(page.getByRole("heading", { name: "Активные пользователи" })).toBeVisible();
  await expect(page.getByText("63% (5 из 8)")).toBeVisible();
});
