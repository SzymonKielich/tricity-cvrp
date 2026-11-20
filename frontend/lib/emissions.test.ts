import { describe, expect, it } from "vitest";
import { emissionDrivers, emissionTotals } from "./emissions";

describe("emissions by distance", () => {
  it("sums the stored emissions and distance of each tour", () => {
    expect(emissionTotals([{ km: 10, co2_kg: 1 }, { km: 20, co2_kg: 4 }]))
      .toEqual({ km: 30, co2_kg: 5 });
    expect(emissionTotals([])).toEqual({ km: 0, co2_kg: 0 });
  });

  it("separates the changes in distance and average rate", () => {
    const drivers = emissionDrivers({ km: 100, co2_kg: 20 }, { km: 75, co2_kg: 7.5 });
    expect(drivers).toEqual({ distance: -5, fleetMix: -7.5, total: -12.5 });
  });

  it("uses a distance-weighted rate and keeps an increase visible", () => {
    const original = emissionTotals([{ km: 10, co2_kg: 1 }, { km: 90, co2_kg: 18 }]);
    const drivers = emissionDrivers(original, { km: 50, co2_kg: 12 })!;
    expect(drivers.distance).toBeCloseTo(-9.5);
    expect(drivers.fleetMix).toBeCloseTo(2.5);
    expect(drivers.distance + drivers.fleetMix).toBeCloseTo(drivers.total);
    expect(emissionDrivers({ km: 0, co2_kg: 0 }, original)).toBeNull();
  });
});
