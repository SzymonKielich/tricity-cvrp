import { describe, expect, it } from "vitest";
import { balancedPlanName, scenarioLabel } from "./format";
import { configSchema, defaultConfig, pareto, positionAt, sameScope } from "./scenario";

describe("scenario configuration", () => {
  it("shows known generated names in the current language, including previously saved Polish names", () => {
    expect(scenarioLabel("Viladecans - plan zrównoważony", "en")).toBe(balancedPlanName);
    expect(scenarioLabel(balancedPlanName, "pl")).toBe("Viladecans - plan zrównoważony");
    expect(scenarioLabel("Viladecans · plan zrównoważony - ponownie", "en")).toBe(`${balancedPlanName} - rerun`);
    expect(scenarioLabel("Viladecans · Balanced pilot - copy", "pl")).toBe("Viladecans - plan zrównoważony - kopia");
    expect(scenarioLabel("Ruch +15% · 2026-11-05", "en")).toBe("Traffic +15% · 2026-11-05");
    expect(scenarioLabel("Plan dostaw do Łodzi", "en")).toBe("Plan dostaw do Łodzi");
  });
  it("accepts the demonstration configuration", () => {
    expect(configSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });
  it("rejects zero fleet and zero weights", () => {
    expect(configSchema.safeParse({ ...defaultConfig, fleet: { cargo_bike: 0, electric_van: 0, diesel_van: 0 } }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, w_eur: 0, w_co2: 0 }).success).toBe(false);
  });
  it("checks order scope and dates independently of date ordering", () => {
    const group = { scope: "all", dates: ["A", "B"] };
    expect(sameScope(group, { scope: "all", dates: ["B", "A"] })).toBe(true);
    expect(sameScope(group, { scope: "participating", dates: ["B", "A"] })).toBe(false);
    expect(sameScope(group, { scope: "all", dates: ["A"] })).toBe(false);
  });
});

describe("route and impact visualizations", () => {
  it("interpolates driving and keeps the point stationary while waiting", () => {
    const segments = [
      { kind: "drive" as const, from: "A", to: "B", start_s: 100, end_s: 200 },
      { kind: "wait" as const, from: "B", to: "B", start_s: 200, end_s: 300 },
    ];
    expect(positionAt(segments, 150)).toEqual({ from: "A", to: "B", ratio: 0.5 });
    expect(positionAt(segments, 250)).toMatchObject({ from: "B", to: "B" });
    expect(positionAt([], 300)).toBeNull();
  });
  it("filters dominated observed cost/emissions points", () => {
    expect(pareto([{ x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }])).toEqual([{ x: 2, y: 1 }, { x: 1, y: 2 }]);
  });
});
