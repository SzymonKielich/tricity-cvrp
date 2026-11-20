"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Button, Chip, MenuItem, TextField, Tooltip } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, FlaskConical, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { post, useRoutes, useVehicles } from "@/lib/api";
import { clock } from "@/lib/format";
import { vehicleLabel } from "@/lib/scenario";
import type { Created, Segment, StressReport } from "@/lib/types";
import { RunSelect, useRunSelection } from "./run-selection";
import { DateField, Page, Panel, State, StatusChip } from "./ui";

const violationLabel: Record<string, string> = {
  pickup_window: "Outside pickup window",
  delivery_window: "Outside delivery window",
  shift_duration: "Tour duration exceeded",
  hub_close: "Return after hub closing time",
  cargo_range: "Cargo bike range exceeded",
};

const start = 8 * 3600;
const finish = 22 * 3600;
const stages: Record<Segment["kind"] | "idle", { label: string; color: string }> = {
  drive: { label: "Driving", color: "#3869a6" },
  pickup: { label: "Pickup handling", color: "#139575" },
  delivery: { label: "Delivery handling", color: "#8067ad" },
  wait: { label: "Waiting", color: "#d6a657" },
  idle: { label: "Idle", color: "#c0cbc5" },
};

export function Operations() {
  const { t, number, scopeLabel } = useLanguage();
  const { selected, date, setDate, eligible, setSelectedId, scenarios } = useRunSelection(true);
  const routes = useRoutes(selected?.job_id ?? null, date);
  const [traffic, setTraffic] = useState(15);
  const [pickup, setPickup] = useState("");
  const [shift, setShift] = useState("");
  const [cargo, setCargo] = useState("");
  const [carbon, setCarbon] = useState("");
  const [report, setReport] = useState<StressReport | null>(null);
  const vehicles = useVehicles();
  const router = useRouter();
  const query = useQueryClient();
  const activeReport = report?.date === date ? report : null;
  const stressTest = useMutation({
    mutationFn: () => post<StressReport>(`/scenarios/${selected?.id}/stress-test`, {
      date, traffic_pct: traffic, pickup_service_min: pickup ? Number(pickup) : null,
      max_shift_h: shift ? Number(shift) : null, cargo_max_km: cargo ? Number(cargo) : null,
    }),
    onSuccess: setReport,
  });
  const reoptimize = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Choose a completed scenario with full coverage.");
      return post<Created>("/optimization/run", {
        name: `Traffic +${traffic}% · ${date}`,
        config: { ...selected.config, dates: [date], travel_buffer_pct: traffic,
          pickup_service_min: pickup ? Number(pickup) : selected.config.pickup_service_min,
          max_shift_h: shift ? Number(shift) : selected.config.max_shift_h,
          cargo_max_km: cargo ? Number(cargo) : selected.config.cargo_max_km,
          w_co2: carbon ? Number(carbon) : selected.config.w_co2 },
      });
    },
    onSuccess: (created) => {
      void query.invalidateQueries({ queryKey: ["scenarios"] });
      router.push(`/studio?job=${created.job_id}`);
    },
  });
  const vehicleRows = (vehicles.data?.vehicles ?? []).filter((vehicle, _, rows) => selected &&
    rows.filter((item) => item.type === vehicle.type).findIndex((item) => item.vehicle_id === vehicle.vehicle_id) < selected.config.fleet[vehicle.type]);

  function field(name: string, value: string, options: number[], onChange: (v: string) => void) {
    return <TextField select size="small" label={name} value={value} onChange={(event) => onChange(event.target.value)} sx={{ minWidth: 120 }}>
      <MenuItem value="">{t("From plan")}</MenuItem>
      {options.map((item) => <MenuItem key={item} value={String(item)}>{item}</MenuItem>)}
    </TextField>;
  }

  return <>
    <Page title={t("Operations timeline")} description={t("Review the vehicle day and test how published schedules absorb traffic and handling delays.")}
      actions={<Button component={Link} href="/routes" variant="outlined" endIcon={<ArrowRight size={15} />}>{t("Route explorer")}</Button>} />
    <div className="inline" style={{ marginBottom: 15 }}>
      <RunSelect choices={eligible} value={selected?.id} onChange={(id) => { setSelectedId(id); setReport(null); }} />
      {selected && <><DateField value={date} choices={selected.config.dates} onChange={(value) => { setDate(value); setReport(null); }} />
        <StatusChip status={selected.status} /><Chip variant="outlined" label={scopeLabel(selected.config.scope)} /></>}
    </div>
    {!selected ? <Panel title={t("Vehicle schedules")}><State loading={scenarios.isLoading} error={scenarios.error} empty={t("A completed scenario with full coverage is required to view vehicle schedules.")} /></Panel> :
      <div className="stack">
        <Panel title={t("Vehicle schedules")} description={t("Operating day · local time · tight windows have 15 minutes of slack or less")}
          footer={<div className="map-legend">{Object.values(stages).map((stage) => <span className="legend-key" key={stage.label}>
            <i className="legend-line" style={{ "--dot": stage.color } as CSSProperties} />{t(stage.label)}</span>)}</div>}>
          {routes.data ? <div className="panel-body table-overflow">
            <div style={{ minWidth: 520 }}>
              <div className="timeline-row muted"><span>{t("Vehicle")}</span>
                <div className="inline" style={{ justifyContent: "space-between", gap: 0 }}>
                  {[8, 10, 12, 14, 16, 18, 20, 22].map((hour) => <span key={hour}>{hour}:00</span>)}
                </div><span style={{ textAlign: "right" }}>{t("Tight")}</span>
              </div>
              {vehicleRows.map((vehicle) => {
                const route = routes.data?.routes.find((item) => item.vehicle_id === vehicle.vehicle_id);
                const tested = activeReport?.routes.find((item) => item.vehicle_id === vehicle.vehicle_id);
                const segments = route?.segments ?? [];
                return <div className="timeline-row" key={vehicle.vehicle_id}>
                  <Tooltip title={t(vehicleLabel[vehicle.type])}><strong>{vehicle.vehicle_id}</strong></Tooltip>
                  <div className="timeline-bar" style={{ background: stages.idle.color }}>
                    {segments.map((segment, i) => <Tooltip key={i} title={`${t(stages[segment.kind].label)} · ${clock(segment.start_s)}-${clock(segment.end_s)}`}>
                      <span style={{ left: `${(segment.start_s - start) / (finish - start) * 100}%`,
                        width: `${(segment.end_s - segment.start_s) / (finish - start) * 100}%`, background: stages[segment.kind].color }} />
                    </Tooltip>)}
                  </div>
                  <span style={{ textAlign: "right" }}>{tested?.violations.length ?
                    <Tooltip title={t(`Stress-test violations: ${tested.violations.length}`, `Liczba naruszeń w teście: ${tested.violations.length}`)}><strong style={{ color: "#b55238" }}>{tested.violations.length}</strong></Tooltip> :
                    route?.tight_windows ? `${route.tight_windows}` : "-"}</span>
                </div>;
              })}
            </div>
          </div> : <State loading={routes.isLoading} error={routes.error} />}
        </Panel>
        <Panel title={t("Sensitivity analysis")} action={<FlaskConical size={17} />} description={t("Adjust assumptions for the selected service day")}>
          <div className="panel-body stack">
            <div className="inline">
              <TextField select size="small" label={t("Traffic increase")} value={traffic} onChange={(event) => setTraffic(Number(event.target.value))} sx={{ minWidth: 125 }}>
                {[0, 10, 15, 25].map((value) => <MenuItem value={value} key={value}>+{value}%</MenuItem>)}
              </TextField>
              {field(t("Pickup time (min)"), pickup, [0, 2, 5], setPickup)}
              {field(t("Tour limit (h)"), shift, [8, 10], setShift)}
              {field(t("Bike range (km)"), cargo, [30, 40, 50], setCargo)}
              {field(t("CO₂ weight · re-solve"), carbon, [0, 1, 3, 10, 30], setCarbon)}
            </div>
            <div className="inline">
              <Button variant="outlined" startIcon={<Activity size={15} />} disabled={stressTest.isPending} onClick={() => stressTest.mutate()}> {t("Stress-test fixed schedule")}</Button>
              <Button variant="contained" startIcon={<Play size={15} />} disabled={reoptimize.isPending} onClick={() => reoptimize.mutate()}> {t("Re-optimize selected day")}</Button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}> {t("A stress test keeps the vehicle assignments and sequence, then propagates delays through planned stops. Re-optimization applies the selected traffic percentage as the solver’s travel buffer and starts a new job with the selected CO₂ weight.")} </div>
            {(stressTest.error || reoptimize.error) && <Alert severity="error">{t((stressTest.error ?? reoptimize.error)?.message ?? "")}</Alert>}
            {activeReport && <Alert severity={activeReport.routes_affected ? "warning" : "success"}>
              <strong>{t("Schedule stress test - traffic up")} {activeReport.traffic_pct}%</strong><br /> {t("Tours with violations:")} {number(activeReport.routes_affected)} {t("of")} {activeReport.routes_tested}.
              {Object.entries(activeReport.violations).map(([key, value]) => ` · ${t(violationLabel[key] ?? key)} ${value}`)}
            </Alert>}
            {activeReport?.routes.some((route) => route.violations.length) &&
              <div className="table-overflow"><table className="metric-table"><thead><tr><th>{t("Vehicle")}</th><th>{t("Forecast return")}</th><th>{t("Violations")}</th></tr></thead>
                <tbody>{activeReport.routes.filter((route) => route.violations.length).map((route) => <tr key={route.route_id}>
                  <td>{route.vehicle_id}</td><td>{clock(route.end_s)}</td>
                  <td>{route.violations.map((item) => `${t(violationLabel[item.kind] ?? item.kind)}${item.order_id ? ` · ${item.order_id}` : ""}`).join(", ")}</td>
                </tr>)}</tbody></table></div>}
          </div>
        </Panel>
      </div>}
  </>;
}
