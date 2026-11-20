"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useBaseline, useDates, useNetwork, useRoutes } from "./api";
import { useRunSelection } from "./run-selection";

export function useRouteExplorer() {
  const params = useSearchParams();
  const queryDate = params.get("date");
  const validDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) && !Number.isNaN(Date.parse(queryDate));
  const selection = useRunSelection(false, validDate ? queryDate : undefined);
  const { selected, date } = selection;
  const dates = useDates();
  const network = useNetwork();
  const [mode, setMode] = useState<"shared" | "baseline">(params.get("plan") === "baseline" ? "baseline" : "shared");
  const baseline = mode === "baseline" || !selected;
  const base = useBaseline(date, selected?.config.scope, mode === "baseline" || selection.scenarios.isSuccess && !selected);
  const optimized = useRoutes(selected?.job_id ?? null, date, !baseline);
  const source = baseline ? base : optimized;
  const routes = source.data?.routes;
  const [routeId, setRouteId] = useState(params.get("vehicle") ?? "");
  const route = routes?.find((item) => item.id === routeId) ?? routes?.[0];

  function updateUrl(values: Record<string, string>) {
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(values)) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    window.history.replaceState(null, "", url);
  }

  function selectVehicle(id: string) {
    setRouteId(id);
    updateUrl({ vehicle: id });
  }

  function selectScenario(id: string) {
    selection.setSelectedId(id);
    setMode("shared");
    setRouteId("");
    updateUrl({ scenario: id, plan: "", vehicle: "" });
  }

  function selectDate(day: string) {
    selection.setDate(day);
    setRouteId("");
    updateUrl({ date: day, vehicle: "" });
  }

  function selectMode(value: typeof mode) {
    setMode(value);
    setRouteId("");
    updateUrl({ plan: value === "baseline" ? value : "", vehicle: "" });
  }

  return { ...selection, dates, network, baseline, baselineMetrics: base.data?.kpis, source, routes, route, setRouteId: selectVehicle,
    selectScenario, selectDate, selectMode,
    playbackKey: JSON.stringify([baseline ? "baseline" : selected?.job_id, selected?.config.scope, date, route?.id]) };
}
