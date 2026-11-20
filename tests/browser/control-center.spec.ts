import { expect, test } from "../../frontend/node_modules/@playwright/test";

test.beforeEach(async ({ page }) => {
  // Use the tile-free map layers in automation, with all Hedyla coordinates and routes intact.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
});

test("navigate, configure a real solve, follow progress and inspect its route after refresh", async ({ page, request }) => {
  const name = `Browser verification ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible();
  await expect(page.getByText("Participating shops", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Network explorer" }).click();
  await expect(page.getByRole("heading", { name: "Network explorer" })).toBeVisible();
  await expect(page.getByText("Visible nodes: 225")).toBeVisible();
  await page.getByRole("link", { name: "Optimization studio", exact: true }).click();
  await page.getByRole("textbox", { name: "Scenario name" }).fill(name);
  await page.getByRole("combobox", { name: "Dataset date" }).click();
  await page.getByRole("option", { name: "6 Nov 2026", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Limit (s / day)" }).fill("20");
  await page.getByRole("button", { name: "Run optimization" }).click();
  await expect(page).toHaveURL(/job=/);
  await expect(page.getByText(/Queued|Running/).first()).toBeVisible();
  const id = new URL(page.url()).searchParams.get("job");
  await expect(page.getByRole("link", { name: "Inspect routes" })).toBeVisible({ timeout: 65_000 });
  const job = await (await request.get(`/api/optimization/jobs/${id}`)).json();
  expect(job.config.dates).toEqual(["2026-11-06"]);
  expect(job.config.time_limit).toBe(20);
  expect(job.result.validation.exit_code).toBe(0);
  const expected = job.result.metrics.optimized;
  await expect(page.getByText(`${expected.delivered} of ${expected.requested} orders`)).toBeVisible();
  await page.getByText("Solver log", { exact: true }).click();
  await expect(page.getByText(/independent constraint checker/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(`${expected.delivered} of ${expected.requested} orders`)).toBeVisible();
  await page.getByRole("link", { name: "Inspect routes" }).click();
  await expect(page.getByRole("heading", { name: "Route explorer" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Open stop schedule" }).click();
  await expect(page.getByText(/Hub departure/).first()).toBeVisible();
  await expect(page.getByText(/Hub return/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close route schedule" }).click();
  await expect(page.getByRole("slider", { name: "Route time" })).toBeVisible();
  await page.getByRole("button", { name: "Original plan", exact: true }).click();
  await expect(page.getByText("Simulated schedule", { exact: true }).first()).toBeVisible();
});

test("browse comparisons, analytics, operations and library", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Comparison table" })).toBeVisible();
  await expect(page.getByText("Fixed charges", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Impact analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cost and emissions trade-offs" })).toBeVisible();
  await page.getByRole("link", { name: "Operations timeline", exact: true }).click();
  await page.getByRole("button", { name: "Stress-test fixed schedule" }).click();
  await expect(page.getByText("Schedule stress test - traffic up 15%")).toBeVisible();
  await page.getByRole("link", { name: "Scenario library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved scenarios" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Viladecans · Balanced pilot" })).toBeVisible();
});

test("mobile studio fits the viewport and navigation opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Optimization studio" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("switches beside the theme control and remembers Polish across navigation and refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible();
  const topbar = page.locator(".top-actions");
  const languages = topbar.getByRole("group", { name: "Language" });
  await expect(topbar.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  await languages.getByRole("button", { name: "Polski" }).click();
  await expect(page.getByRole("heading", { name: "Przegląd sieci" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await page.getByRole("link", { name: "Przegląd tras" }).click();
  await expect(page.getByRole("heading", { name: "Przegląd tras" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ładunek pojazdu" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Przegląd tras" })).toBeVisible();
  await expect(topbar.getByRole("button", { name: "Polski" })).toHaveAttribute("aria-pressed", "true");
  await topbar.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Route explorer" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
