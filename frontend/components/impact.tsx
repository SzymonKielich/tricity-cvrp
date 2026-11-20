"use client";

import { useLanguage } from "@/lib/language";
import { useMemo } from "react";
import { Alert, Chip } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { ScatterChart } from "@mui/x-charts/ScatterChart";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useKpis } from "@/lib/api";
import { metricCopy } from "@/lib/metric-notes";
import { pareto, sameScope, vehicleLabel } from "@/lib/scenario";
import type { ShopShare, Vehicle } from "@/lib/types";
import { RunSelect, useRunSelection } from "./run-selection";
import { CostNote, Coverage, MetricHint, Page, Panel, State } from "./ui";

export function Impact() {
  const { t, scenarioLabel, categoryLabel, change, number, scopeLabel } = useLanguage();
  const { baselineName, baselineDefinition, metricNotes, percentChange } = metricCopy(t);
  const shopColumns = useMemo<GridColDef<ShopShare>[]>(() => [
    { field: "shop_id", headerName: t("Shop"), width: 104 },
    { field: "shop_type", headerName: t("Category"), flex: 1, minWidth: 125, valueGetter: (value: string) => categoryLabel(value) },
    { field: "orders", headerName: t("Orders"), description: t("Source order count for this shop on the selected dates."), type: "number", width: 95, valueGetter: (value: string) => Number(value) },
    { field: "baseline_cost_eur", headerName: t("Original plan (€)"), description: t("Sum of the original Hedyla estimated route costs for this shop and date range, rounded to cents per source route."), type: "number", width: 135, valueGetter: (value: string) => Number(value), valueFormatter: (value: number) => number(value, 2) },
    { field: "shared_cost_eur", headerName: t("Allocated (€)"), description: t("Share of modeled shared-tour costs assigned to this shop on the selected dates. Each tour is split by its orders’ stand-alone round-trip distances."), type: "number", width: 135, valueGetter: (value: string) => Number(value), valueFormatter: (value: number) => number(value, 2) },
    { field: "saving_pct", headerName: t("Modeled difference (%)"), description: t("Relative change = (allocated cost - original route cost) ÷ original route cost × 100."), type: "number", width: 135, valueGetter: (value: string) => -Number(value), valueFormatter: (value: number) => change(value) },
  ], [t, categoryLabel, number, change]);
  const { selected, eligible, setSelectedId, scenarios } = useRunSelection(true);
  const report = useKpis(selected?.job_id ?? null);
  const m = report.data;
  const chartPoints = eligible.flatMap((scenario) => {
    const metrics = scenario.result?.metrics?.optimized;
    return selected && metrics && metrics.fulfillment_pct === 100 &&
      sameScope(scenario.config, selected.config) && scenario.fingerprint === selected.fingerprint ?
      [{ x: metrics.cost_eur, y: metrics.co2_kg, id: scenario.id, name: scenarioLabel(scenario.name), weight: scenario.config.w_co2 }] : [];
  });
  const frontier = pareto(chartPoints);
  const remainder = chartPoints.filter((point) => !frontier.includes(point));

  return <>
    <Page title={t("Impact analytics")} description={baselineDefinition}
      actions={<RunSelect choices={eligible} value={selected?.id} onChange={setSelectedId} />} />
    {!m || !selected ? <Panel title={t("Impact report")}><State loading={scenarios.isLoading || Boolean(selected && report.isLoading)}
      error={report.error ?? scenarios.error} empty={t("Run a scenario with full coverage to analyze its impact.")} /></Panel> :
      <div className="stack">
        <div className="inline"><strong><Coverage metrics={m.optimized} /><MetricHint label={t("order coverage")} text={metricNotes.fulfillment_pct} /></strong><Chip variant="outlined" label={scopeLabel(selected.config.scope)} />
          <Chip variant="outlined" label={t(`Orders on multi-shop tours: ${m.optimized.grouped_orders}`, `Zamówienia na trasach łączących sklepy: ${m.optimized.grouped_orders}`)} /><MetricHint label={t("orders on multi-shop tours")} text={metricNotes.grouped_orders} /></div>
        <div className="three-col">
          <Panel title={t("Distance change")} description={t("Source matrix kilometers")} action={<MetricHint label={t("distance change")} text={metricNotes.km + " " + percentChange} />}>
            <div className="panel-body"><div className="kpi-reading">{m.changes?.km == null ? "-" : change(m.changes.km)}</div>
              <span className="muted" style={{ fontSize: 12 }}>{number(m.baseline.km, 1)} → {number(m.optimized.km, 1)} km</span></div>
          </Panel>
          <Panel title={t("Emissions change")} description={t("Distance × vehicle emission factor")} action={<MetricHint label={t("emissions change")} text={metricNotes.co2_kg + " " + percentChange} />}>
            <div className="panel-body"><div className="kpi-reading">{m.changes?.co2_kg == null ? "-" : change(m.changes.co2_kg)}</div>
              <span className="muted" style={{ fontSize: 12 }}>{number(m.baseline.co2_kg, 1)} → {number(m.optimized.co2_kg, 1)} kg CO₂e</span></div>
          </Panel>
          <Panel title={t("Load utilization by weight")} description={t("Average over driven kilometers")} action={<MetricHint label={t("weight utilization")} text={metricNotes.weight_utilization_pct} />}>
            <div className="panel-body"><div className="kpi-reading">{number(m.optimized.weight_utilization_pct, 1)}%</div>
              <span className="muted" style={{ fontSize: 12 }}>{baselineName} {number(m.baseline.weight_utilization_pct, 1)}%</span></div>
          </Panel>
        </div>
        <div className="two-col">
          <Panel title={t("Cost decomposition")} description={m.changes?.variable_eur == null ? t("Modeled EUR") : t(`Variable cost ${change(m.changes.variable_eur)} vs the original plan`, `Koszt zmienny ${change(m.changes.variable_eur)} względem planu bazowego`)}
            action={<MetricHint label={t("variable and fixed costs")} text={metricNotes.variable_eur + " " + metricNotes.fixed_eur + " " + percentChange} />}>
            <BarChart xAxis={[{ scaleType: "band", data: [baselineName, t("Shared plan")] }]} yAxis={[{ label: "EUR", width: 65 }]}
              series={[{ data: [m.baseline.variable_eur, m.optimized.variable_eur], label: t("Variable"), stack: "cost", color: "#078366" },
                { data: [m.baseline.fixed_eur, m.optimized.fixed_eur], label: t("Fixed"), stack: "cost", color: "#8fa99e" }]} height={255} />
          </Panel>
          <Panel title={t("Fleet mix")} description={t("Tours by vehicle class")} action={<MetricHint label={t("fleet mix")} text={metricNotes.fleet} />}>
            <BarChart xAxis={[{ scaleType: "band", data: Object.values(vehicleLabel).map((label) => t(label)) }]} yAxis={[{ label: t("Tours"), width: 45 }]}
              series={[{ data: (Object.keys(vehicleLabel) as Vehicle[]).map((kind) => m.baseline.fleet[kind] ?? 0), label: baselineName, color: "#8fa99e" },
                { data: (Object.keys(vehicleLabel) as Vehicle[]).map((kind) => m.optimized.fleet[kind] ?? 0), label: t("Shared plan"), color: "#078366" }]} height={255} />
          </Panel>
        </div>
        <Panel title={t("Cost and emissions trade-offs")} description={t("Fully served, validated plans on the selected dates and scope")}
          action={<MetricHint label={t("cost and emissions")} text={t("Each point is a saved run for these dates and shops. The frontier contains runs for which no displayed run improves one metric without worsening the other.")} />}
          footer={<>{t("Non-dominated points are calculated from the saved runs shown here. OR-Tools used a time-limited heuristic search.")}</>}>
          {frontier.length > 0 && <ScatterChart height={300} xAxis={[{ label: t("Modeled cost (EUR)") }]} yAxis={[{ label: t("Emissions (kg CO₂e)"), width: 65 }]}
            series={[
              { data: frontier, label: t("Observed Pareto frontier"), color: "#098568", markerSize: 8,
                valueFormatter: (value) => value ? `€${number(value.x, 2)} · ${number(value.y, 2)} kg CO₂e` : "" },
              ...(remainder.length ? [{ data: remainder, label: t("Other completed plans"), color: "#7791ab", markerSize: 6 }] : []),
            ]} />}
          <div className="panel-body" style={{ paddingTop: 0 }}>
            {frontier.map((point) => <Chip key={point.id} size="small"
              label={t(`${point.name} · CO₂ weight ${number(point.weight, 1)}`, `${point.name} · waga CO₂ ${number(point.weight, 1)}`)} color="success" variant="outlined" sx={{ mr: 1, mb: 1 }} />)}
          </div>
          {chartPoints.length < 2 && <Alert severity="info" sx={{ m: 2 }}>{t("Run another scenario at a different CO₂ weight to explore the trade-off.")}</Alert>}
        </Panel>
        <Panel title={t("Shop-level cost allocation")} description={t("Shared route costs are allocated by each order’s stand-alone round-trip distance")}
          action={<MetricHint label={t("shop cost allocation")} text={t("For each tour, use twice the Hedyla matrix distance from shop to destination as each order’s share weight. Sum allocated modeled euros by shop and compare with the original per-route Hedyla estimated costs.")} />}>
          <div style={{ height: 375 }}>
            <DataGrid rows={m.shop_cost_sharing} columns={shopColumns} getRowId={(item) => item.shop_id}
              density="compact" disableRowSelectionOnClick initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              pageSizeOptions={[10, 25, 50]} sx={{ border: 0, "--DataGrid-containerBackground": "var(--soft)" }} />
          </div>
        </Panel>
        <CostNote />
      </div>}
  </>;
}
