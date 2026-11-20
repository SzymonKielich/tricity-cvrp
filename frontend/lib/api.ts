import { useQuery } from "@tanstack/react-query";
import type { Baseline, DateOption, Job, JobEvents, KpiReport, Network, RouteView, Scenario, Scope, Status, Summary, Vehicle, VehicleClass } from "./types";

export function active(status: Status | null | undefined) {
  return status === "queued" || status === "running";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { ...init.headers, "Content-Type": "application/json" } : init?.headers,
  });
  if (!response.ok) {
    const body: { detail?: string | { message?: string } | { msg: string }[] } = await response.json().catch(() => ({}));
    const detail = body.detail;
    const message = Array.isArray(detail) ? detail.map((item) => item.msg).join(" ") :
      typeof detail === "string" ? detail : detail?.message;
    throw new Error(message ?? `Request failed (${response.status}).`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const post = <T,>(path: string, body?: object) =>
  api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/dataset/summary"), staleTime: Infinity });
export const useNetwork = () => useQuery({ queryKey: ["network"], queryFn: () => api<Network>("/network"), staleTime: Infinity });
export const useDates = () => useQuery({ queryKey: ["dates"], queryFn: () => api<DateOption[]>("/dates"), staleTime: Infinity });
export const useVehicles = () => useQuery({ queryKey: ["vehicles"], queryFn: () => api<{ classes: VehicleClass[]; vehicles: { vehicle_id: string; type: Vehicle }[] }>("/vehicles"), staleTime: Infinity });
export const useScenarios = () => useQuery({
  queryKey: ["scenarios"], queryFn: () => api<Scenario[]>("/scenarios"),
  refetchInterval: (query) => query.state.data?.some((scenario) => active(scenario.status)) ? 1400 : 10000,
});
export const useJob = (id: string | null) => useQuery({
  queryKey: ["job", id], queryFn: () => api<Job>(`/optimization/jobs/${id}`), enabled: Boolean(id),
  refetchInterval: (query) => active(query.state.data?.status) ? 800 : false,
});
export const useEvents = (id: string | null, pending: boolean) => useQuery({
  queryKey: ["events", id, pending], queryFn: () => api<JobEvents>(`/optimization/jobs/${id}/events`),
  enabled: Boolean(id), refetchInterval: pending ? 1200 : false,
});
export const useBaseline = (date: string, scope: Scope = "participating", enabled = true) =>
  useQuery({ queryKey: ["baseline", date, scope], queryFn: () => api<Baseline>(`/baseline?date=${date}&scope=${scope}`), enabled: Boolean(date) && enabled, staleTime: Infinity });
export const useRoutes = (id: string | null, date: string, enabled = true) =>
  useQuery({ queryKey: ["routes", id, date], queryFn: () => api<RouteView>(`/optimization/jobs/${id}/routes?date=${date}`), enabled: Boolean(id && date && enabled), staleTime: Infinity });
export const useKpis = (id: string | null) =>
  useQuery({ queryKey: ["kpis", id], queryFn: () => api<KpiReport>(`/optimization/jobs/${id}/kpis`), enabled: Boolean(id), staleTime: Infinity });
