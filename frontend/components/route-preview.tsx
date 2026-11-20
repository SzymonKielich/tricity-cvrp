"use client";

import { useLanguage } from "@/lib/language";
import type { ComponentType } from "react";
import { useRouteExplorer } from "@/lib/route-explorer";
import { vehicleLabel } from "@/lib/scenario";
import { RouteSimulation, type PlayerProps, type RouteCard } from "./route-simulation";

export interface PreviewSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function RoutePreview({ Card, Select, Player }: {
  Card: RouteCard; Select: ComponentType<PreviewSelectProps>; Player?: ComponentType<PlayerProps>;
}) {
  const { t, scenarioLabel, dateLabel, number, scopeLabel } = useLanguage();
  const explorer = useRouteExplorer();
  const { selected, eligible, date, dates, routes, route, baseline, network, source, scenarios } = explorer;
  const days = selected?.config.dates ?? dates.data?.map((day) => day.date) ?? [];
  const metrics = baseline ? explorer.baselineMetrics : selected?.result?.metrics?.optimized;
  const error = scenarios.error ?? network.error ?? source.error;
  return <>
    <h1>{t("Route explorer")}</h1>
    <div className="preview-filters">
      <Select label={t("Scenario")} value={selected?.id ?? ""} onChange={explorer.selectScenario}
        options={eligible.map((item) => ({ value: item.id, label: scenarioLabel(item.name) }))} />
      <Select label={t("Date")} value={date} onChange={explorer.selectDate}
        options={days.map((day) => ({ value: day, label: dateLabel(day) }))} />
      <Select label="Plan" value={baseline ? "baseline" : "shared"} onChange={(value) => explorer.selectMode(value === "baseline" ? value : "shared")}
        options={[...(selected ? [{ value: "shared", label: t("Shared plan") }] : []), { value: "baseline", label: t("Original plan") }]} />
      <Select label={baseline ? t("Shop route") : t("Vehicle")} value={route?.id ?? ""} onChange={explorer.setRouteId}
        options={routes?.map((item) => ({ value: item.id,
          label: `${item.vehicle_id ?? item.id} · ${t(vehicleLabel[item.vehicle_type])} · ${number(item.km, 1)} km` })) ?? []} />
    </div>
    {baseline && <p className="preview-context">{t("The original plan reconstructs the shops’ delivery routes from Hedyla data. Delivery times are simulated.")}</p>}
    {metrics && <p className="preview-context"><strong>{metrics.delivered} {t("of")} {metrics.requested} {t("orders")}</strong> · {
      scopeLabel(selected?.config.scope ?? "participating")
    }{!baseline && days.length > 1 ? t(" - coverage across all dates") : ""}{routes && t(` - tours on this date: ${routes.length}`, ` · ${routes.length} tras w wybranym dniu`)}</p>}
    {!baseline && selected?.status === "incomplete" && <p role="status">{t("Some orders in this scenario were not served.")}</p>}
    {error && <p role="alert">{t(error.message)}</p>}
    {route ? <RouteSimulation route={route} playbackKey={explorer.playbackKey} network={network.data}
      baseline={baseline} hub={baseline ? undefined : selected?.config.hub} Card={Card} Player={Player} /> :
      !error && <p role="status">{scenarios.isLoading || source.isLoading ? t("Loading routes…") : t("No routes for the selected date.")}</p>}
  </>;
}
