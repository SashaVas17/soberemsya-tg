import { expect, test } from "@playwright/test";

// Runs against the production build (vite preview), where csp.ts puts the
// Content-Security-Policy into index.html; the dev server has none.
test("the production build works under its Content-Security-Policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("csp-violation")) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.log(`csp-violation ${event.violatedDirective} ${event.blockedURI}`));
  });
  // The map server is stubbed as in smoke.spec.ts; CSP is checked before the stub answers.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#efeae4" } }] }),
        })
      : route.fulfill({ status: 404, body: "" }));

  await page.goto("./");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Ближайшая встреча" })).toBeVisible();

  await page.goto("./#/places");
  await page.getByRole("tab", { name: "Карта" }).click();
  await expect(page.locator(".venue-map canvas, .venue-map-unsupported").first()).toBeVisible();

  await page.goto("./#/settings");
  await expect(page.getByRole("heading", { name: "Язык" })).toBeVisible();

  expect(violations).toEqual([]);
});
