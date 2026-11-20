"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Button, Drawer, IconButton, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { ArrowRight, Bike, Box, Clock3, House, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouteExplorer } from "@/lib/route-explorer";
import { clock } from "@/lib/format";
import { vehicleColor, vehicleLabel } from "@/lib/scenario";
import type { Route, Status } from "@/lib/types";
import { RouteSimulation } from "./route-simulation";
import { RunScope, RunSelect } from "./run-selection";
import { DateField, Page, Panel, State, StatusChip } from "./ui";

function RouteDetails({ route, baseline, onClose }: { route: Route | undefined; baseline: boolean; onClose: () => void }) {
  const { t, number } = useLanguage();
  const items = route?.stops.flatMap((stop, i) => {
    const kind = stop.kind === "pickup" ? t("Shop pickup") : stop.kind === "delivery" ? t("Customer delivery") :
      i === 0 ? baseline ? t("Shop departure") : t("Hub departure") : baseline ? t("Shop return") : t("Hub return");
    const waiting = route.segments.find((segment) => segment.kind === "wait" && segment.end_s === stop.arrival_s && segment.to === stop.location);
    return [...(waiting ? [{ hour: waiting.start_s, label: t("Waiting"), location: stop.location,
      detail: `${number((waiting.end_s - waiting.start_s) / 60, 1)} min`, icon: Clock3 }] : []),
      { hour: stop.arrival_s, label: kind, location: stop.location, detail: stop.order_id,
        icon: stop.kind === "pickup" ? Box : stop.kind === "delivery" ? MapPin : House }];
  }) ?? [];
  return <Drawer open={Boolean(route)} onClose={onClose} anchor="right" slotProps={{ paper: { sx: { width: { xs: "94vw", sm: 430 } } } }}>
    <div className="panel-header"><div><h2 className="panel-title">{t("Route schedule")}</h2><p>{route?.id}</p></div>
      <IconButton aria-label={t("Close route schedule")} onClick={onClose}><X size={18} /></IconButton>
    </div>
    <div className="panel-body">
      {baseline && <Alert severity="info" sx={{ mb: 1 }}>{t("Simulated using the source visit order and matrix times.")}</Alert>}
      {items.map(({ hour, label, location, detail, icon: Icon }, i) =>
        <div className="inline" key={i} style={{ display: "grid", gridTemplateColumns: "48px 20px 1fr", minHeight: 52, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
          <span className="muted">{clock(hour)}</span><Icon size={15} /><div><strong>{label} · {location}</strong>
            {detail && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{detail}</div>}</div>
        </div>)}
    </div>
  </Drawer>;
}

export function RouteExplorer() {
  const { t, number } = useLanguage();
  const { selected, date, eligible, dates, network, baseline, source, routes, route, setRouteId,
    selectScenario, selectDate, selectMode, playbackKey, scenarios, baselineMetrics } = useRouteExplorer();
  const [drawer, setDrawer] = useState(false);
  const status: Status = baseline ? "unverified" : selected?.status ?? "unverified";
  const coverage = baseline ? baselineMetrics : selected?.result?.metrics?.optimized;

  const vehicles = <Panel title={baseline ? t("Shop routes") : t("Vehicles")} description={t(`Tours: ${routes?.length ?? 0}`, `Liczba tras: ${routes?.length ?? 0}`)}
    action={<RunScope scenario={selected} />}>
    <div style={{ maxHeight: 230, overflow: "auto" }}>
      {routes?.map((item) => <button key={item.id} onClick={() => setRouteId(item.id)}
        aria-pressed={item.id === route?.id} className="route-choice">
        <span className="route-indicator" style={{ background: vehicleColor[item.vehicle_type] }} /><span>
          <strong>{item.vehicle_id ?? item.id}</strong><small>{t(vehicleLabel[item.vehicle_type])} {t("· orders:")} {item.orders}</small>
        </span><span>{number(item.km, 1)} km</span>
      </button>)}
    </div>
  </Panel>;

  return <>
    <Page title={t("Route explorer")} description={t("Inspect vehicle tours, stop order and delivery windows on the network.")}
      actions={<Button component={Link} href="/studio" variant="outlined" endIcon={<ArrowRight size={15} />}>{t("Optimization studio")}</Button>} />
    <div className="inline" style={{ marginBottom: 12 }}>
      <RunSelect choices={eligible} value={selected?.id} onChange={selectScenario} />
      <DateField value={date} choices={selected?.config.dates ?? dates.data} onChange={selectDate} />
      <ToggleButtonGroup value={baseline ? "baseline" : "shared"} exclusive size="small" aria-label={t("Route source")}
        onChange={(_, value: "baseline" | "shared" | null) => { if (value) selectMode(value); }}>
        <ToggleButton value="shared" disabled={!selected}>{t("Shared plan")}</ToggleButton><ToggleButton value="baseline">{t("Original plan")}</ToggleButton>
      </ToggleButtonGroup>
      <StatusChip status={status} />
      {coverage && <strong>{coverage.delivered} {t("of")} {coverage.requested} {t("orders")}{!baseline && selected && selected.config.dates.length > 1 ? t(" - all scenario dates") : ""}</strong>}
    </div>
    {baseline && <p className="muted">{t("The original plan reconstructs the shops’ delivery routes from Hedyla data. Delivery times are simulated.")}</p>}
    {status === "incomplete" && <Alert severity="warning" sx={{ mb: 2 }}>{t("This run has unserved orders. Its routes are available for diagnosis.")}</Alert>}
    {network.error && <State error={network.error} />}
    {route ? <RouteSimulation playbackKey={playbackKey} route={route} network={network.data}
      hub={baseline ? undefined : selected?.config.hub} baseline={baseline} Card={Panel} sidebar={vehicles}
      details={<Panel title={t("Tour details")}>
        <div className="panel-body">
          <div className="inline" style={{ fontSize: 12, marginBottom: 6 }}><Bike size={15} /> {t(vehicleLabel[route.vehicle_type])} {t("· shops:")} {route.shops.length}</div>
          <table className="metric-table"><tbody>
            {[
              [t("Orders"), number(route.orders)], [t("Distance"), `${number(route.km, 1)} km`],
              [t("Emissions"), `${number(route.co2_kg, 2)} kg CO₂e`], [t("Modeled cost"), `€${number(route.cost_eur, 2)}`],
              [t("Tour duration"), `${number((route.end_s - route.start_s) / 60, 0)} min`],
              [t("Peak weight capacity"), `${number(route.peak_weight_pct, 1)}%`],
              [t("Load utilization by weight"), `${number(route.weight_utilization_pct, 1)}%`],
              [baseline ? t("Simulated delivery punctuality") : t("Planned delivery punctuality"), `${number(route.delivery_on_time_pct, 1)}%`],
            ].map(([key, val]) => <tr key={key}><td>{key}</td><td>{val}</td></tr>)}
          </tbody></table>
          <Button variant="outlined" fullWidth size="small" sx={{ mt: 1 }} endIcon={<ArrowRight size={14} />}
            onClick={() => setDrawer(true)}>{t("Open stop schedule")}</Button>
        </div>
      </Panel>} /> : <State loading={scenarios.isLoading || source.isLoading} error={source.error ?? scenarios.error} empty={t("This day has no generated routes.")} />}
    <RouteDetails route={drawer ? route : undefined} baseline={baseline} onClose={() => setDrawer(false)} />
  </>;
}
