import type { Translate } from "./language";
import type { Metrics } from "./types";

export const baselineName = "Original plan";
export const baselineDefinition = "The original plan reconstructs the shops’ delivery routes from Hedyla data. Delivery times and punctuality for this plan are simulated.";
export const percentChange = "Relative change = (shared plan - original plan) ÷ original plan × 100. The value is unavailable when the reference is zero.";

export const metricNotes = {
  requested: "Orders in the selected dates and shop scope, counted from hedyla_orders.csv.",
  delivered: "Distinct orders covered by the route sequence in the selected dates and shop scope.",
  km: "Kilometers in the selected dates and shop scope. Sum of all legs from hedyla_distance_matrix.csv, including departure and return.",
  co2_kg: "Kilograms of CO₂e in the selected dates and shop scope. For each tour, multiply matrix kilometers by its vehicle’s kg CO₂e/km from hedyla_vehicles.csv, then sum.",
  cost_eur: "Modeled euros in the selected dates and shop scope. Variable transport cost plus fixed vehicle charges.",
  variable_eur: "Modeled euros in the selected dates and shop scope. For each tour, multiply matrix kilometers by its vehicle’s EUR/km from hedyla_vehicles.csv, then sum.",
  fixed_eur: "Modeled euros in the selected dates and shop scope. Apply the fixed EUR rate from hedyla_vehicles.csv once per shop route in the original plan, or once per used vehicle per day in the shared plan.",
  cost_per_order_eur: "Modeled total euros divided by orders served on the selected dates and shop scope.",
  fulfillment_pct: "Percent of requested orders covered in the selected dates and shop scope. Orders served ÷ requested orders × 100.",
  delivery_on_time_pct: "Percent of served orders whose service starts within their delivery window. Uses planned times for the shared plan and simulated times for the original plan.",
  pickup_on_time_pct: "Percent of shared-plan pickups that start and finish within the shop window. The original shop routes have no pickup schedule.",
  weight_utilization_pct: "Average percent of the vehicle weight limit across all driven kilometers, including empty legs. Sum of (kg onboard ÷ kg limit × leg km) ÷ total km × 100.",
  volume_utilization_pct: "Average percent of the vehicle volume limit across all driven kilometers, including empty legs. Sum of (m³ onboard ÷ m³ limit × leg km) ÷ total km × 100.",
  vehicle_hours: "Sum of departure-to-return hours for every tour on the selected dates. Includes driving, service and waiting. The original plan uses simulated travel and service.",
  waiting_hours: "Sum in hours of gaps between reaching a stop and starting service on shared tours. Arrival is estimated from the distance matrix and congestion. Unavailable for original shop routes.",
  empty_km: "Total matrix kilometers with zero onboard weight in the selected dates and shop scope.",
  grouped_orders: "Count of served orders on tours carrying orders from two or more shops in the selected period.",
  grouped_pct: "Percent of orders served on tours carrying orders from two or more shops in the selected period.",
  routes: "Count of shop routes or shared tours across the selected dates and shop scope.",
  fleet: "Count of tours by vehicle class across the selected dates and shop scope. A vehicle may be counted again on a different day.",
} satisfies Record<keyof Metrics, string>;


export function metricCopy(t: Translate) {
  return {
    baselineName: t(baselineName),
    baselineDefinition: t(baselineDefinition),
    percentChange: t(percentChange),
    metricNotes: Object.fromEntries(Object.entries(metricNotes).map(([key, value]) => [key, t(value)])) as Record<keyof Metrics, string>,
  };
}
