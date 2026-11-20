import { expect, test } from "../../frontend/node_modules/@playwright/test";
import type { RouteView } from "../../frontend/lib/types";

const sample = "5c7e08ce-1aa5-4707-86b2-c4451a13e326";
const job = "9dd902ae-f4c4-47a0-bc9d-35da65e67970";

for (const variant of ["css", "mui"]) {
  test(`${variant} preview plays the saved route, scrubs cargo and reloads with the selected vehicle`, async ({ page, request }, testInfo) => {
    const response = await request.get(`/api/optimization/jobs/${job}/routes`);
    const { routes }: RouteView = await response.json();
    const [first, second] = routes;
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.goto(`/preview/${variant}?scenario=${sample}`);
    await expect(page.getByText("184 of 184 orders", { exact: true })).toBeVisible();
    const slider = page.getByRole("slider", { name: "Route time" });
    const time = page.locator("output");
    const count = page.getByLabel("Orders on board");
    const vehicle = page.getByRole("combobox", { name: "Vehicle" });
    const speed = page.getByRole("combobox", { name: "Speed" });
    const marker = page.getByRole("img", { name: "Route simulation" });
    await expect(marker).toBeVisible();
    for (const rate of ["1500", "3000", "6000"]) {
      await expect(speed.locator(`option[value="${rate}"]`)).toHaveText(`${rate}×`);
    }
    const initial = await time.textContent();
    const initialPosition = await marker.getAttribute("style");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(time).not.toHaveText(initial!);
    await expect.poll(() => marker.getAttribute("style")).not.toBe(initialPosition);
    await speed.selectOption("1500");
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await time.textContent();

    async function seek(offset: number) {
      await slider.evaluate((element, value) => {
        const change = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        change.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, offset);
    }

    await expect(time).toHaveText(paused!);
    const pickup = first.stops.find((stop) => stop.kind === "pickup")!;
    const delivery = first.stops.find((stop) => stop.kind === "delivery")!;
    await seek(Math.ceil(pickup.departure_s - first.start_s));
    await expect(page.getByText(/^Picked up /)).toBeVisible();
    await expect(page.getByRole("cell", { name: pickup.order_id, exact: true })).toBeVisible();
    await testInfo.attach(`${variant}-desktop.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await seek(Math.ceil(delivery.departure_s - first.start_s));
    await expect(page.getByText(/^Delivered /)).toBeVisible();
    await expect(page.getByRole("cell", { name: delivery.order_id, exact: true })).toHaveCount(0);
    await slider.press("End");
    await expect(page.getByText("End of route", { exact: true })).toBeVisible();
    await expect(count).toHaveText("0");
    await speed.selectOption("3000");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByText("End of route", { exact: true })).toHaveCount(0);
    await vehicle.selectOption(second.id);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(count).toHaveText("0");
    await expect(page.getByRole("heading", { name: `Route map · ${second.vehicle_id}` })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(vehicle).toHaveValue(second.id);
    await expect(marker).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach(`${variant}-mobile.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByRole("button", { name: "Schematic view" }).click();
    await expect(page.getByRole("group", { name: "Interactive schematic map" })).toBeVisible();
    await page.getByRole("link", { name: variant === "css" ? "Material UI" : "CSS" }).click();
    await expect(page.getByRole("img", { name: "Route simulation" })).toBeVisible();
  });

  test(`${variant} preview loads the schematic automatically with WebGL disabled`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        value: function (name: string, options: unknown) {
          return name.includes("webgl") ? null : Reflect.apply(original, this, [name, options]);
        },
      });
    });
    await page.goto(`/preview/${variant}?scenario=${sample}`);
    const map = page.getByRole("group", { name: "Interactive schematic map" });
    await expect(map.locator("polyline")).toBeVisible();
    await page.reload();
    await expect(map.locator("polyline")).toBeVisible();
  });
}
