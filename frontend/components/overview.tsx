"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Button, Chip, MenuItem, TextField } from "@mui/material";
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, Coins, Leaf, Map, Package, Route as RouteIcon, Store, Truck, Weight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useBaseline, useDates, useNetwork, useRoutes, useScenarios, useSummary } from "@/lib/api";
import { metricCopy } from "@/lib/metric-notes";
import { DEFAULT_DATE } from "@/lib/scenario";
import type { ChangeKey, Scope } from "@/lib/types";
import { Legend, NetworkMap, Schematic } from "./network-map";
import { CostNote, Coverage, DateField, MetricHint, metricRows, metricValue, Page, Panel, State } from "./ui";

function Kpi({ title, value, unit, icon, note, hint }: { title: string; value: string; unit?: string; icon: ReactNode; note: ReactNode; hint: string }) {
  return <div className="panel kpi-tile">
    <div className="kpi-label"><span>{title}<MetricHint label={title} text={hint} /></span>{icon}</div>
    <div className="kpi-reading">{value}{unit && <span className="unit">{unit}</span>}</div>
    <div className="kpi-subtitle">{note}</div>
  </div>;
}

export function Overview() {
  const { t, scenarioLabel, change, dateLabel, number, scopeLabel } = useLanguage();
  const { baselineName, baselineDefinition, metricNotes, percentChange } = metricCopy(t);
  const [date, setDate] = useState(DEFAULT_DATE);
  const [scope, setScope] = useState<Scope>("participating");
  const [mapMode, setMapMode] = useState("shared");
  const summary = useSummary();
  const dates = useDates();
  const network = useNetwork();
  const scenarios = useScenarios();
  const baseline = useBaseline(date, scope);
  const latest = scenarios.data?.find((item) => item.status === "verified");
  const matching = scenarios.data?.find((item) => item.status === "verified" && item.config.scope === scope &&
    item.config.dates.length === 1 && item.config.dates[0] === date);
  const routes = useRoutes(matching?.job_id ?? null, date);
  const base = baseline.data?.kpis;
  const shared = matching?.result?.metrics?.optimized;
  const current = shared ?? base;
  const selectedDate = dates.data?.find((item) => item.date === date);
  const mapRoutes = mapMode === "baseline" || !matching ? baseline.data?.routes : routes.data?.routes;

  function note(key: ChangeKey) {
    const delta = matching?.result?.metrics?.changes?.[key];
    return delta == null ? baselineName : <><span className={delta > 0 ? "delta up" : "delta"}>{change(delta)}</span>
      <span>{t("vs the original plan")}</span></>;
  }

  return <>
    <Page title={t("Network overview")} description={baselineDefinition}
      actions={<Button component={Link} href="/studio" variant="contained" endIcon={<ArrowRight size={16} />}>{t("Open optimization studio")}</Button>} />
    <div className="inline" style={{ marginBottom: 15, justifyContent: "space-between" }}>
      <div className="inline">
        <DateField value={date} choices={dates.data} onChange={setDate} />
        <TextField select label={t("Order scope")} size="small" value={scope}
          onChange={(event) => setScope(event.target.value as Scope)} sx={{ minWidth: 153 }}>
          <MenuItem value="participating">{t("Participating shops")}</MenuItem><MenuItem value="all">{t("All shops")}</MenuItem>
        </TextField>
        <Chip label={t("Synthetic dataset")} variant="outlined" />
      </div>
      {current && <strong><Coverage metrics={current} /><MetricHint label={t("order coverage")} text={metricNotes.fulfillment_pct} /></strong>}
    </div>
    {(summary.error || baseline.error) && <State error={summary.error ?? baseline.error} />}
    <div className="kpi-grid">
      <Kpi hint={t("Count of network shops whose platform_participant flag is 1 in hedyla_shops.csv, across the whole dataset.")} title={t("Participating shops")} value={number(summary.data?.participating_shops)} icon={<Store size={16} />}
        note={summary.data ? t(`of ${summary.data.shops} shops in the network`, `z ${summary.data.shops} sklepów w sieci`) : t("Network shops")} />
      <Kpi hint={metricNotes.requested} title={t("Orders in scope")} value={number(scope === "all" ? selectedDate?.orders : selectedDate?.participating_orders)}
        icon={<Package size={16} />} note={`${dateLabel(date)} · ${scopeLabel(scope)}`} />
      <Kpi hint={t("Count of vehicle IDs in hedyla_vehicles.csv. This is the source fleet across all classes.")} title={t("Dataset vehicles")} value={number(summary.data?.vehicles)} icon={<Truck size={16} />}
        note={t("Cargo bikes · Electric vans · Diesel vans")} />
      <Kpi hint={metricNotes.km + " " + percentChange} title={t("Distance in scope")} value={number(current?.km, 1)} unit="km" icon={<RouteIcon size={16} />} note={note("km")} />
      <Kpi hint={metricNotes.co2_kg + " " + percentChange} title={t("Modeled transport emissions")} value={number(current?.co2_kg, 1)} unit="kg CO₂e" icon={<Leaf size={16} />} note={note("co2_kg")} />
      <Kpi hint={metricNotes.cost_eur + " " + percentChange} title={t("Modeled transport cost")} value={number(current?.cost_eur, 2)} unit="EUR" icon={<Coins size={16} />} note={note("cost_eur")} />
      <Kpi hint={metricNotes.delivery_on_time_pct} title={shared ? t("Planned deliveries on time") : t("Simulated deliveries on time")} value={number(current?.delivery_on_time_pct, 1)} unit="%" icon={<CheckCircle2 size={16} />}
        note={current ? t(`Orders served: ${current.delivered}`, `Obsłużone zamówienia: ${current.delivered}`) : "-"} />
      <Kpi hint={metricNotes.weight_utilization_pct} title={t("Load utilization by weight")} value={number(current?.weight_utilization_pct, 1)} unit="%" icon={<Weight size={16} />}
        note={t("Weight · distance-weighted")} />
    </div>
    <div className="app-grid">
      <Panel title={t("Network explorer")} description={`${scopeLabel(scope)} · ${dateLabel(date)}`}
        action={<TextField select size="small" label={t("Map view")} value={matching ? mapMode : "baseline"}
          onChange={(event) => setMapMode(event.target.value)} sx={{ minWidth: 135 }}>
          <MenuItem value="shared" disabled={!matching}>{t("Shared plan")}</MenuItem><MenuItem value="baseline">{baselineName}</MenuItem>
        </TextField>}
        footer={<><Legend nature={matching && mapMode !== "baseline" ? "routes" : "network"} /><Schematic /></>}>
        <NetworkMap network={network.data} height={375}
          layers={mapRoutes ? [{ routes: mapRoutes, baseline: mapMode === "baseline" || !matching }] : undefined}
          hub={matching?.config.hub} />
      </Panel>
      <div className="stack">
        <Panel title={t(`${baselineName} and shared plan`, `${baselineName} i plan współdzielony`)} description={t("Same date and order scope")}
          action={<Link aria-label={t("Scenario comparison")} href="/compare"><ArrowUpRight size={18} /></Link>}>
          {base ? <div className="panel-body table-overflow">
            <table className="metric-table"><thead><tr><th>{t("Measure")}</th><th>{baselineName}</th><th>{t("Shared plan")}</th></tr></thead>
              <tbody>{["km", "co2_kg", "cost_eur", "variable_eur", "fixed_eur", "delivery_on_time_pct"].map((key) => {
                const row = metricRows.find((metric) => metric.key === key)!;
                return <tr key={key}><td>{t(row.title)}<MetricHint label={t(row.title)} text={metricNotes[row.key]} /></td>
                  <td>{metricValue(base[row.key], row.unit, row.precision, number)}</td>
                  <td>{shared ? metricValue(shared[row.key], row.unit, row.precision, number) : "-"}</td></tr>;
              })}</tbody>
            </table>
          </div> : <State loading={baseline.isLoading} />}
          {!matching && <div className="panel-footer">{t("Run this date and scope to compare results.")}</div>}
        </Panel>
        <Panel title={t("Latest plan with full coverage")}>
          {latest ? <div className="panel-body">
            <strong style={{ fontSize: 14 }}>{scenarioLabel(latest.name)}</strong>
            <div className="inline muted" style={{ marginTop: 8, fontSize: 11 }}><CalendarDays size={14} />
              {latest.config.dates.length === 1 ? dateLabel(latest.config.dates[0]) : t(`Service days: ${latest.config.dates.length}`, `Dni dostaw: ${latest.config.dates.length}`)}
              <span>· {scopeLabel(latest.config.scope)}</span>
            </div>
            <Button component={Link} href={`/routes?scenario=${latest.id}`} size="small" sx={{ mt: 1, ml: -1 }}
              startIcon={<Map size={15} />} endIcon={<ArrowRight size={14} />}>{t("Inspect routes")}</Button>
          </div> : <State loading={scenarios.isLoading} error={scenarios.error} empty={t("No completed plans with full coverage yet.")} />}
        </Panel>
      </div>
    </div>
    <div style={{ marginTop: 15 }}><CostNote /></div>
    {matching && !shared && <Alert severity="warning" sx={{ mt: 2 }}>{t("The shared plan report could not be loaded.")}</Alert>}
  </>;
}
