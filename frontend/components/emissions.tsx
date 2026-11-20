"use client";

import { useState } from "react";
import { Chip, MenuItem, Slider, TextField } from "@mui/material";
import { ScatterChart } from "@mui/x-charts/ScatterChart";
import { useBaseline, useRoutes, useVehicles } from "@/lib/api";
import { emissionDrivers, emissionTotals } from "@/lib/emissions";
import { useLanguage } from "@/lib/language";
import { vehicleColor, vehicleLabel } from "@/lib/scenario";
import type { Route } from "@/lib/types";
import { RunSelect, useRunSelection } from "./run-selection";
import { Coverage, DateField, Page, Panel, State } from "./ui";

type PlanFilter = "both" | "original" | "shared";

function EmissionChart({ original, shared }: { original: Route[]; shared: Route[] }) {
  const { t, number } = useLanguage();
  const [filter, setFilter] = useState<PlanFilter>("both");
  const plans = [
    { id: "original", name: t("Original plan"), routes: original },
    { id: "shared", name: t("Shared plan"), routes: shared },
  ].filter((plan) => filter === "both" || filter === plan.id);
  const series = (Object.keys(vehicleColor) as Route["vehicle_type"][]).flatMap((kind) => {
    const data = plans.flatMap((plan) => plan.routes.filter((route) => route.vehicle_type === kind)
      .map((route) => ({ id: `${plan.name} · ${route.id}`, x: route.km, y: route.co2_kg })));
    return data.length ? [{
      id: kind, label: t(vehicleLabel[kind]), color: vehicleColor[kind], markerSize: 5, data,
      valueFormatter: (point: { id?: string | number; x: number; y: number } | null) =>
        point ? `${point.id} · ${number(point.x, 2)} km · ${number(point.y, 3)} kg CO₂e` : "",
    }] : [];
  });

  return <Panel title={t("Emissions per tour")} description={t("Each point is one tour. Color shows vehicle type.")}
    action={<TextField select label={t("Routes shown")} size="small" value={filter}
      onChange={(event) => setFilter(event.target.value as PlanFilter)} sx={{ minWidth: 160 }}>
      <MenuItem value="both">{t("Both plans")}</MenuItem>
      <MenuItem value="original">{t("Original plan")}</MenuItem>
      <MenuItem value="shared">{t("Shared plan")}</MenuItem>
    </TextField>}>
    <ScatterChart
      height={340}
      xAxis={[{ min: 0, label: t("Distance (km)"), valueFormatter: (v: number) => number(v) }]}
      yAxis={[{ min: 0, width: 68, label: t("Emissions (kg CO₂e)"), valueFormatter: (v: number) => number(v, 1) }]}
      grid={{ horizontal: true, vertical: true }}
      series={series}
    />
  </Panel>;
}

function DistanceCalculator() {
  const { t, number } = useLanguage();
  const vehicles = useVehicles();
  const [km, setKm] = useState(50);
  return <Panel title={t("Same distance, different vehicles")}>
    {vehicles.data ? <div className="panel-body">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <span>{t("Travel distance")}</span><strong>{number(km)} km</strong>
      </div>
      <Slider aria-label={t("Travel distance")} getAriaValueText={(value) => `${number(value)} km`}
        min={0} max={150} step={1} value={km} onChange={(_, value) => setKm(Number(value))} />
      <div className="table-overflow"><table className="metric-table">
        <thead><tr><th scope="col">{t("Vehicle")}</th><th scope="col">kg CO₂e/km</th><th scope="col">kg CO₂e</th></tr></thead>
        <tbody>{vehicles.data.classes.map((vehicle) => {
          const factor = vehicle.emissions_kgco2e_per_km;
          return <tr key={vehicle.type}>
            <th scope="row">{t(vehicleLabel[vehicle.type])}</th><td>{number(factor, 3)}</td><td>{number(km * factor, 2)}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </div> : <State loading={vehicles.isLoading} error={vehicles.error} />}
  </Panel>;
}

function PlanComparison({ originalRoutes, sharedRoutes }: { originalRoutes: Route[]; sharedRoutes: Route[] }) {
  const { t, number } = useLanguage();
  const original = emissionTotals(originalRoutes);
  const shared = emissionTotals(sharedRoutes);
  const drivers = emissionDrivers(original, shared);
  const signedKg = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${number(Math.abs(v), 2)} kg CO₂e`;
  return <Panel title={t("What changed between plans?")}>
    <div className="panel-body">
      <div className="table-overflow"><table className="metric-table">
        <thead><tr><th scope="col">{t("Plan")}</th><th scope="col">km</th><th scope="col">kg CO₂e</th></tr></thead>
        <tbody>
          <tr><th scope="row">{t("Original plan")}</th><td>{number(original.km, 1)}</td><td>{number(original.co2_kg, 2)}</td></tr>
          <tr><th scope="row">{t("Shared plan")}</th><td>{number(shared.km, 1)}</td><td>{number(shared.co2_kg, 2)}</td></tr>
        </tbody>
      </table></div>
      {drivers && <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "6px 12px", fontSize: 13, alignItems: "baseline" }}>
        <dt>{t("Distance effect")}</dt><dd style={{ margin: 0 }}>{signedKg(drivers.distance)}</dd>
        <dt>{t("Vehicle mix effect")}</dt><dd style={{ margin: 0 }}>{signedKg(drivers.fleetMix)}</dd>
        <dt><strong>{t("Total change")}</strong></dt><dd style={{ margin: 0 }}><strong>{signedKg(drivers.total)}</strong></dd>
      </dl>}
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        {t("First change the total distance at the original plan’s average rate per kilometer. Then switch to the shared plan’s rate. The vehicle mix effect depends on the kilometers driven by each vehicle type.")}
      </p>
    </div>
  </Panel>;
}

export function Emissions() {
  const { t, scopeLabel } = useLanguage();
  const { selected, date, setDate, eligible, setSelectedId, scenarios } = useRunSelection(true);
  const original = useBaseline(date, selected?.config.scope, Boolean(selected));
  const shared = useRoutes(selected?.job_id ?? null, date);
  const loading = scenarios.isLoading || Boolean(selected && (original.isLoading || shared.isLoading));
  return <>
    <Page title={t("Emissions by distance")}
      description={t("Modeled emissions = distance traveled × the vehicle’s emission factor.")} />
    <div className="inline" style={{ marginBottom: 15 }}>
      <RunSelect choices={eligible} value={selected?.id} onChange={setSelectedId} />
      {selected && <DateField value={date} choices={selected.config.dates} onChange={setDate} />}
      {selected && <Chip variant="outlined" label={scopeLabel(selected.config.scope)} />}
      {original.data && <strong><Coverage metrics={original.data.kpis} /></strong>}
    </div>
    {original.data && shared.data ? <div className="stack">
      <EmissionChart original={original.data.routes} shared={shared.data.routes} />
      <div className="two-col">
        <PlanComparison originalRoutes={original.data.routes} sharedRoutes={shared.data.routes} />
        <DistanceCalculator />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        {t("Distances come from the Hedyla distance matrix. Emission factors come from hedyla_vehicles.csv. The model uses a fixed factor per kilometer, with no separate adjustment for speed, traffic, load or idling. These are modeled transport emissions for synthetic orders.")}
      </p>
    </div> : <State loading={loading} error={scenarios.error ?? original.error ?? shared.error}
      empty={t("Run a scenario with full coverage to compare emissions.")} />}
  </>;
}
