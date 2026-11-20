import { describe, expect, it } from "vitest";
import { cargoAt, cargoTimeline, stopIndexAt } from "./route-playback";
import type { Route, Stop } from "./types";

function stop(kind: Stop["kind"], location: string, arrival_s: number, departure_s: number, order_id = ""): Stop {
  return { kind, location, arrival_s, departure_s, order_id, load_kg: 0, load_m3: 0,
    priority: null, window_start_s: null, window_end_s: null, slack_s: null };
}

const cargo: Route["cargo"] = {
  initial_order_ids: [],
  capacity_kg: 80,
  capacity_m3: .6,
  orders: {
    a: { order_id: "a", shop_id: "S", destination_id: "D1", weight_kg: 5, volume_m3: .03 },
    b: { order_id: "b", shop_id: "S", destination_id: "D2", weight_kg: 8, volume_m3: .06 },
  },
};

describe("cargo on the playback timeline", () => {
  it("changes on service completion, groups consecutive pickups and supports reverse scrubbing", () => {
    const stops = [stop("depot", "H", 100, 100), stop("pickup", "S", 200, 250, "a"),
      stop("pickup", "S", 250, 300, "b"), stop("delivery", "D1", 600, 700, "a"),
      stop("delivery", "D2", 800, 800, "b"), stop("depot", "H", 1000, 1000)];
    const timeline = cargoTimeline({ stops, cargo });
    expect(cargoAt(timeline, 249).orders).toHaveLength(0);
    expect(cargoAt(timeline, 250)).toMatchObject({ weight: 5, volume: .03, event: { kind: "pickup", count: 1 } });
    expect(cargoAt(timeline, 300)).toMatchObject({ weight: 13, volume: .09, event: { kind: "pickup", count: 2 } });
    expect(cargoAt(timeline, 699)).toBe(cargoAt(timeline, 300));
    expect(cargoAt(timeline, 700)).toMatchObject({ weight: 8, volume: .06, event: { kind: "delivery", count: 1 } });
    expect(cargoAt(timeline, 800).orders).toHaveLength(0);
    expect(cargoAt(timeline, 280).orders).toEqual([cargo.orders.a]);
    expect(stopIndexAt(stops, 699)).toBe(3);
    expect(stopIndexAt(stops, 1000)).toBe(5);
  });

  it("starts an original shop route loaded and processes simultaneous zero-duration events in stop order", () => {
    const stops = [stop("depot", "S", 100, 100), stop("delivery", "D1", 200, 200, "a"),
      stop("delivery", "D2", 200, 200, "b"), stop("depot", "S", 300, 300)];
    const timeline = cargoTimeline({ stops, cargo: { ...cargo, initial_order_ids: ["a", "b"] } });
    expect(cargoAt(timeline, 100).orders).toEqual([cargo.orders.a, cargo.orders.b]);
    expect(cargoAt(timeline, 199).weight).toBe(13);
    expect(cargoAt(timeline, 200).orders).toHaveLength(0);
    expect(stopIndexAt(stops, 200)).toBe(2);
  });
});
