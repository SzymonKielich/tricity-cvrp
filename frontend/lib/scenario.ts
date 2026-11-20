import { z } from "zod";
import type { Config, Segment, Vehicle } from "./types";

export const DEFAULT_DATE = "2026-11-05";
export const vehicleLabel: Record<Vehicle, string> = {
  cargo_bike: "Cargo bike", electric_van: "Electric van", diesel_van: "Diesel van",
};
export const vehicleColor: Record<Vehicle, string> = {
  cargo_bike: "#049377", electric_van: "#305ed2", diesel_van: "#b46523",
};
export const defaultConfig: Config = {
  dates: [DEFAULT_DATE], scope: "participating", hub: "COM018", max_shift_h: 8,
  cargo_max_km: 40, pickup_service_min: 2, travel_buffer_pct: 15, w_eur: 1, w_co2: 1,
  priority_hard: true, fleet: { cargo_bike: 8, electric_van: 8, diesel_van: 8 }, time_limit: 15,
};
export const presets = {
  "Original plan comparison": { scope: "participating", travel_buffer_pct: 0, w_eur: 1, w_co2: 1 },
  "Balanced": { scope: "participating", travel_buffer_pct: 15, w_eur: 1, w_co2: 1 },
  "Lowest emissions": { w_eur: 0, w_co2: 1, time_limit: 30 },
  "Lowest modeled cost": { w_eur: 1, w_co2: 0, time_limit: 30 },
  "Operationally conservative": { travel_buffer_pct: 25, pickup_service_min: 5, time_limit: 45 },
  "Custom": {},
} satisfies Record<string, Partial<Config>>;
export type Preset = keyof typeof presets;
export const presetDescriptions: Record<Preset, string> = {
  "Original plan comparison": "Source traffic, with no added travel buffer. Compares against original shop routes from Hedyla.",
  "Balanced": "Cost + CO₂ objective, 15% travel buffer, 8-hour shifts and 2-minute pickups.",
  "Lowest emissions": "Emissions-only objective with a 30-second search budget per day.",
  "Lowest modeled cost": "Modeled transport cost only, with a 30-second search budget per day.",
  "Operationally conservative": "25% travel buffer, 5-minute pickup handling and a 45-second search per day.",
  "Custom": "Uses the settings shown below.",
};

export const configSchema = z.object({
  dates: z.array(z.string()).min(1, "Select a dataset date.").max(45),
  scope: z.enum(["participating", "all"]),
  hub: z.string().min(1),
  max_shift_h: z.number().min(4).max(14),
  cargo_max_km: z.number().min(1).max(150),
  pickup_service_min: z.number().min(0).max(10).multipleOf(0.5),
  travel_buffer_pct: z.number().int().min(0).max(100),
  w_eur: z.number().min(0).max(100),
  w_co2: z.number().min(0).max(100),
  priority_hard: z.boolean(),
  fleet: z.object({
    cargo_bike: z.number().int().min(0).max(8),
    electric_van: z.number().int().min(0).max(8),
    diesel_van: z.number().int().min(0).max(8),
  }).refine((value) => Object.values(value).some((quantity) => quantity > 0), "Enable at least one vehicle."),
  time_limit: z.number().int().min(1).max(120),
}).refine((value) => value.w_eur > 0 || value.w_co2 > 0, { message: "Set a positive objective weight.", path: ["w_eur"] });

export const studioSchema = z.object({ name: z.string().trim().min(1).max(100), config: configSchema });

export function positionAt(segments: Segment[], time: number) {
  if (!segments.length) return null;
  const segment = segments.find((candidate) => time < candidate.end_s) ?? segments.at(-1)!;
  const ratio = Math.min(1, Math.max(0, (time - segment.start_s) / (segment.end_s - segment.start_s)));
  return { from: segment.from, to: segment.to, ratio };
}

export function sameScope(a: { dates: string[]; scope: string }, b: { dates: string[]; scope: string }) {
  return a.scope === b.scope && [...a.dates].sort().join() === [...b.dates].sort().join();
}

export function pareto<T extends { x: number; y: number }>(points: T[]): T[] {
  return points.filter((a) => !points.some((b) => b.x <= a.x && b.y <= a.y && (b.x < a.x || b.y < a.y)));
}
