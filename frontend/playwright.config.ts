import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 100_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.SHAREDROP_TEST_URL ?? "http://127.0.0.1:3140",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
});
