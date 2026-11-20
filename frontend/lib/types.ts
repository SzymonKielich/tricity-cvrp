export type Vehicle = "cargo_bike" | "electric_van" | "diesel_van";
export type Scope = "participating" | "all";
export type Status = "queued" | "running" | "verified" | "incomplete" | "failed" | "cancelled" | "unverified";

export interface Config {
  dates: string[];
  scope: Scope;
  hub: string;
  max_shift_h: number;
  cargo_max_km: number;
  pickup_service_min: number;
  travel_buffer_pct: number;
  w_eur: number;
  w_co2: number;
  priority_hard: boolean;
  fleet: Record<Vehicle, number>;
  time_limit: number;
}

export interface Node {
  id: string;
  kind: "shop" | "destination";
  participant?: boolean;
  latitude: number;
  longitude: number;
  category: string;
  zones: string[];
  shops?: string[];
  window_start?: string;
  window_end?: string;
}

export interface Network {
  nodes: Node[];
  hub: string;
  zones: string[];
}

export interface Summary {
  shops: number;
  participating_shops: number;
  destinations: number;
  orders: number;
  vehicles: number;
  days: number;
  default_date: string;
  hub: string;
  fingerprint: string;
  synthetic: boolean;
  baseline_routes: number;
}

export interface DateOption { date: string; orders: number; participating_orders: number }
export interface VehicleClass {
  type: Vehicle;
  available: number;
  capacity_kg: number;
  capacity_m3: number;
  cost_eur_per_km: number;
  emissions_kgco2e_per_km: number;
  fixed_shift_cost_eur: number;
}

export interface Metrics {
  requested: number;
  delivered: number;
  km: number;
  co2_kg: number;
  cost_eur: number;
  variable_eur: number;
  fixed_eur: number;
  cost_per_order_eur: number | null;
  fulfillment_pct: number | null;
  delivery_on_time_pct: number | null;
  pickup_on_time_pct: number | null;
  weight_utilization_pct: number | null;
  volume_utilization_pct: number | null;
  empty_km: number;
  grouped_orders: number;
  grouped_pct: number | null;
  vehicle_hours: number;
  waiting_hours: number | null;
  routes: number;
  fleet: Partial<Record<Vehicle, number>>;
}

export interface Stop {
  location: string;
  kind: "depot" | "pickup" | "delivery";
  arrival_s: number;
  departure_s: number;
  order_id: string;
  load_kg: number;
  load_m3: number;
  priority: string | null;
  window_start_s: number | null;
  window_end_s: number | null;
  slack_s: number | null;
}

export interface Segment {
  kind: "drive" | "wait" | "pickup" | "delivery";
  start_s: number;
  end_s: number;
  from: string;
  to: string;
}

export interface CargoOrder {
  order_id: string;
  shop_id: string;
  destination_id: string;
  weight_kg: number;
  volume_m3: number;
}

export interface Route {
  id: string;
  date: string;
  vehicle_id: string | null;
  vehicle_type: Vehicle;
  shop: string | null;
  shops: string[];
  orders: number;
  stops: Stop[];
  cargo: {
    initial_order_ids: string[];
    orders: Record<string, CargoOrder>;
    capacity_kg: number;
    capacity_m3: number;
  };
  segments: Segment[];
  km: number;
  empty_km: number;
  co2_kg: number;
  cost_eur: number;
  start_s: number;
  end_s: number;
  peak_weight_pct: number | null;
  peak_volume_pct: number | null;
  weight_utilization_pct: number | null;
  delivery_on_time_pct: number | null;
  tight_windows: number;
}

export interface RouteView { date: string; routes: Route[]; status: Status }
export interface Baseline extends RouteView { scope: Scope; kpis: Metrics }
export type ChangeKey = "km" | "co2_kg" | "cost_eur" | "variable_eur";
export interface MetricPair { optimized: Metrics; baseline: Metrics; changes: Partial<Record<ChangeKey, number>> | null }
export interface ShopShare {
  shop_id: string;
  shop_type: string;
  orders: string;
  baseline_cost_eur: string;
  shared_cost_eur: string;
  saving_pct: string;
}
export interface KpiReport extends MetricPair {
  status: Status;
  shop_cost_sharing: ShopShare[];
  by_day: Record<string, Omit<MetricPair, "changes">>;
}

export interface Scenario {
  id: string;
  name: string;
  config: Config;
  fingerprint: string;
  created_at: string;
  finished_at: string | null;
  parent_id: string | null;
  job_id: string | null;
  status: Status | null;
  result: { status: Status; metrics: MetricPair | null; warnings: string[] } | null;
}

export interface Job {
  id: string;
  scenario_id: string;
  name: string;
  config: Config;
  status: Status;
  phase: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  solver_version: string;
  fingerprint: string;
  error: string | null;
  result: {
    status: Status;
    warnings: string[];
    metrics: MetricPair | null;
    unserved_order_ids: string[];
    validation: { exit_code: number; checks: string[]; coverage_complete: boolean; report: string };
  } | null;
}

export interface JobEvents { status: Status; phase: string; events: { sequence: number; message: string }[]; terminal: boolean }
export interface Created { scenario_id: string; job_id: string | null; duplicate: boolean }

export interface StressReport {
  type: "fixed_schedule_stress_test";
  date: string;
  traffic_pct: number;
  routes_tested: number;
  routes_affected: number;
  violations: Record<string, number>;
  routes: { route_id: string; vehicle_id: string; end_s: number; violations: { kind: string; order_id?: string; seconds_late?: number }[] }[];
  method: string;
}
