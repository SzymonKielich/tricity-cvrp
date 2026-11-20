"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Button, MenuItem, TextField } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { ArrowRight, Layers2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { useBaseline, useNetwork, useRoutes, useScenarios } from "@/lib/api";
import { metricCopy } from "@/lib/metric-notes";
import { sameScope, vehicleLabel } from "@/lib/scenario";
import type { Metrics, Scenario, Vehicle } from "@/lib/types";
import { NetworkMap, Schematic, type RouteLayer } from "./network-map";
import { CostNote, Coverage, DateField, MetricHint, metricRows, metricValue, Page, Panel, State, StatusChip } from "./ui";

const palette = ["#08765f", "#486ac2", "#a65591"];
const baselineColor = "#818d88";
const fleetTypes = Object.keys(vehicleLabel) as Vehicle[];

export function Compare() {
  const { t, scenarioLabel, change, scopeLabel, number } = useLanguage();
  const { baselineName, baselineDefinition, metricNotes, percentChange } = metricCopy(t);
  const params = useSearchParams();
  const scenarios = useScenarios();
  const available = scenarios.data?.filter((item) => item.result?.metrics) ?? [];
  const [requested, setRequested] = useState<string[] | null>(() => params.get("ids")?.split(",") ?? null);
  const [mapDay, setMapDay] = useState("");
  const [showBaseline, setShowBaseline] = useState(true);
  const seed = available.find((item) => item.status === "verified") ?? available[0];
  const comparisons = seed ? available.filter((item) => sameScope(item.config, seed.config) && item.fingerprint === seed.fingerprint && item.status === "verified") : [];
  const initial = comparisons.length ? comparisons.slice(0, 2).map((item) => item.id) : seed ? [seed.id] : [];
  const chosen: Scenario[] = (requested ?? initial).slice(0, 3).flatMap((id) => {
    const match = available.find((item) => item.id === id);
    return match ? [match] : [];
  });
  const first = chosen[0];
  const compatible = chosen.every((item) => first && sameScope(item.config, first.config) && item.fingerprint === first.fingerprint);
  const ready = compatible && chosen.length > 0 && chosen.every((item) => item.status === "verified");
  const firstMetrics = first?.result?.metrics;
  const date = first?.config.dates.includes(mapDay) ? mapDay : first?.config.dates[0] ?? "";
  const network = useNetwork();
  const baseline = useBaseline(date, first?.config.scope, Boolean(first && showBaseline && compatible));
  const route1 = useRoutes(chosen[0]?.job_id ?? null, date, compatible);
  const route2 = useRoutes(chosen[1]?.job_id ?? null, date, compatible);
  const route3 = useRoutes(chosen[2]?.job_id ?? null, date, compatible);
  const layers: RouteLayer[] = [...(showBaseline && baseline.data ? [{ routes: baseline.data.routes, baseline: true, color: baselineColor }] : []),
    ...[route1, route2, route3].flatMap((result, i) => result.data ? [{ routes: result.data.routes, color: palette[i] }] : [])];
  const labels = [baselineName, ...chosen.map((_, i) => `Plan ${i + 1}`)];
  const metrics: Metrics[] = firstMetrics ? [firstMetrics.baseline, ...chosen.flatMap((item) => item.result?.metrics?.optimized ?? [])] : [];

  function choose(i: number, id: string) {
    const copy = [...(requested ?? initial)];
    copy[i] = id;
    setRequested(copy.filter((item, index) => item && copy.indexOf(item) === index));
  }

  return <>
    <Page title={t("Scenario comparison")} description={baselineDefinition}
      actions={<Button component={Link} href="/scenarios" endIcon={<ArrowRight size={15} />} variant="outlined">{t("Scenario library")}</Button>} />
    <div className="inline" style={{ marginBottom: 15 }}>
      {[0, 1, 2].map((i) => <TextField select size="small" label={`Plan ${i + 1}`} value={chosen[i]?.id ?? ""}
        key={i} sx={{ minWidth: 170, maxWidth: "100%" }} onChange={(event) => choose(i, event.target.value)}>
        <MenuItem value="">{t("Choose a scenario")}</MenuItem>
        {available.map((item) => <MenuItem value={item.id} key={item.id} disabled={chosen.some((picked, j) => j !== i && picked.id === item.id)}>
          {scenarioLabel(item.name)}{item.status === "incomplete" ? t(" - Incomplete") : ""}
        </MenuItem>)}
      </TextField>)}
    </div>
    {!chosen.length ? <Panel title={t("Saved plans")}><State loading={scenarios.isLoading} error={scenarios.error} empty={t("Run a scenario to start comparing results.")} /></Panel> : <div className="stack">
      {!compatible && <Alert severity="warning">{t("Choose scenarios with identical dates, scope and dataset fingerprint to calculate differences and overlay routes.")}</Alert>}
      {compatible && !ready && <Alert severity="warning">{t("Incomplete plans are shown for coverage and diagnostics. Modeled differences and charts require complete, validated plans.")}</Alert>}
      {ready && <div className="three-col">
        {([
          ["km", t("Distance"), "km"], ["co2_kg", t("Emissions"), "kg CO₂e"], ["cost_eur", t("Modeled cost"), "EUR"],
        ] as const).map(([field, title, unit]) => <Panel title={title} description={unit} key={field} action={<MetricHint label={title} text={metricNotes[field]} />}>
          <BarChart xAxis={[{ scaleType: "band", data: labels }]} yAxis={[{ width: 52 }]}
            series={[{ data: metrics.map((item) => item[field]), label: unit, color: "#0a8066" }]}
            height={208} hideLegend margin={{ left: 0, right: 14, top: 15, bottom: 15 }} />
        </Panel>)}
      </div>}
      <Panel title={t("Comparison table")} description={compatible && first ? t(`${scopeLabel(first.config.scope)} · Days: ${first.config.dates.length} - utilization is distance-weighted`, `${scopeLabel(first.config.scope)} · Liczba dni: ${first.config.dates.length} - wykorzystanie ważone dystansem`) : t("Metrics use each plan’s own scope")}>
        <div className="panel-body table-overflow">
          <table className="metric-table"><thead><tr><th>{t("Metric")}</th>{compatible && <th>{baselineName}<br /><StatusChip status="unverified" /></th>}
            {chosen.map((item, i) => <th key={item.id}><span title={scenarioLabel(item.name)}>Plan {i + 1} · {scenarioLabel(item.name)}</span><br /><StatusChip status={item.status} /></th>)}</tr></thead>
            <tbody>{metricRows.map((row) => <tr key={row.key}><td>{t(row.title)}<MetricHint label={t(row.title)} text={metricNotes[row.key] + (ready && ["km", "co2_kg", "cost_eur", "variable_eur"].includes(row.key) ? " " + percentChange : "")} /></td>
              {compatible && firstMetrics && <td>{row.key === "fulfillment_pct" ? <Coverage metrics={firstMetrics.baseline} /> : metricValue(firstMetrics.baseline[row.key], row.unit, row.precision, number)}</td>}
              {chosen.map((item) => {
                const pair = item.result?.metrics;
                const delta = pair?.changes?.[row.key as keyof NonNullable<typeof pair.changes>];
                return <td key={item.id}>{pair ? row.key === "fulfillment_pct" ? <Coverage metrics={pair.optimized} /> : metricValue(pair.optimized[row.key], row.unit, row.precision, number) : "-"}
                  {ready && delta != null && <span className={delta > 0 ? "delta up" : "delta"} style={{ marginLeft: 7 }}>{change(delta)}</span>}</td>;
              })}</tr>)}
            {fleetTypes.map((kind) => <tr key={kind}><td>{t(vehicleLabel[kind])} {t("- tours")}<MetricHint label={t(`${t(vehicleLabel[kind])} - tours`, `${t(vehicleLabel[kind])} - trasy`)} text={metricNotes.fleet} /></td>
              {compatible && firstMetrics && <td>{firstMetrics.baseline.fleet[kind] ?? 0}</td>}
              {chosen.map((item) => <td key={item.id}>{item.result?.metrics?.optimized.fleet[kind] ?? 0}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Panel>
      {compatible && <CostNote />}
      {compatible && <Panel title={t("Scenario map")} description={t("Overlay routes from the same service day")}
        action={<div className="inline"><DateField value={date} choices={first.config.dates} onChange={setMapDay} />
          <Button variant={showBaseline ? "contained" : "outlined"} aria-pressed={showBaseline} startIcon={<Layers2 size={15} />}
            size="small" onClick={() => setShowBaseline(!showBaseline)}>{baselineName}</Button></div>}
        footer={<><div className="map-legend">
          {showBaseline && <span className="legend-key"><i className="legend-line" style={{ "--dot": baselineColor } as CSSProperties} />{baselineName}</span>}
          {chosen.map((item, i) => <span className="legend-key" key={item.id}>
            <i className="legend-line" style={{ "--dot": palette[i] } as CSSProperties} />Plan {i + 1}</span>)}
        </div><Schematic /></>}>
        <NetworkMap network={network.data} layers={layers} hub={first.config.hub} height={382} />
      </Panel>}
    </div>}
  </>;
}
