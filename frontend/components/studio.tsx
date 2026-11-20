"use client";

import { useLanguage } from "@/lib/language";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Chip, CircularProgress, MenuItem, TextField, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { Activity, ArrowRight, CalendarDays, Gauge, MapPinned, Play, Save, Settings2, ShieldCheck, SlidersHorizontal, Terminal, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { active, post, useBaseline, useDates, useEvents, useJob, useNetwork, useRoutes, useScenarios, useVehicles } from "@/lib/api";
import { balancedPlanName } from "@/lib/format";
import { DEFAULT_DATE, defaultConfig, presetDescriptions, presets, studioSchema, vehicleLabel, type Preset } from "@/lib/scenario";
import { metricCopy } from "@/lib/metric-notes";
import type { ChangeKey, Config, Created, Job, Vehicle } from "@/lib/types";
import { Legend, NetworkMap, Schematic } from "./network-map";
import { CostNote, Coverage, DateField, MetricHint, Page, Panel, State, StatusChip } from "./ui";

type FormValues = { name: string; config: Config };
type ConfigPath = FieldPath<FormValues>;

const anchors: { key: ChangeKey | "fixed_eur"; title: string; unit: string }[] = [
  { key: "km", title: "Distance", unit: "km" }, { key: "co2_kg", title: "Emissions", unit: "kg CO₂e" },
  { key: "variable_eur", title: "Variable cost", unit: "EUR" },
  { key: "fixed_eur", title: "Fixed charges", unit: "EUR" }, { key: "cost_eur", title: "Modeled total cost", unit: "EUR" },
];
const fleetKinds = Object.keys(vehicleLabel) as Vehicle[];
const phaseLabel: Record<string, string> = {
  queued: "Waiting for the solver", starting: "Loading input", solving: "OR-Tools search",
  validating: "Independent validation", reporting: "Recalculating KPIs", finished: "Finished",
};

function Elapsed({ job }: { job: Job }) {
  const { t } = useLanguage();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active(job.status)) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [job.status]);
  const seconds = job.started_at ? Math.max(0, Math.floor(((job.finished_at ? Date.parse(job.finished_at) : Date.now()) -
    Date.parse(job.started_at)) / 1000)) : 0;
  return <span>{Math.floor(seconds / 60)} min {String(seconds % 60).padStart(2, "0")} s
    <MetricHint label={t("elapsed time")} text={t("Wall-clock minutes and seconds from worker start to completion or the current time. Includes input, search, validation and reporting.")} />
  </span>;
}

export function Studio() {
  const { t, scenarioLabel, categoryLabel, change, dateLabel, number, scopeLabel } = useLanguage();
  const { baselineName, baselineDefinition, metricNotes, percentChange } = metricCopy(t);
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");
  const scenarioId = params.get("scenario");
  const selectedScenarioQuery = useScenarios();
  const linkedScenario = selectedScenarioQuery.data?.find((scenario) => scenario.id === scenarioId);
  const job = useJob(jobId);
  const events = useEvents(jobId, active(job.data?.status) || Boolean(jobId && !job.data));
  const network = useNetwork();
  const dates = useDates();
  const vehicles = useVehicles();
  const query = useQueryClient();
  const [preset, setPreset] = useState<Preset>("Balanced");
  const [mode, setMode] = useState<"day" | "batch">("day");
  const [mapView, setMapView] = useState<"baseline" | "shared">("shared");
  const [resultDate, setResultDate] = useState("");
  const [notice, setNotice] = useState("");
  const loaded = useRef("");
  const form = useForm<FormValues>({
    resolver: zodResolver(studioSchema),
    defaultValues: { name: balancedPlanName, config: defaultConfig },
  });
  const settings = form.watch("config");
  const baselineDate = job.data?.config.dates.includes(resultDate) ? resultDate : job.data?.config.dates[0];
  const previewDate = baselineDate ?? settings.dates[0] ?? DEFAULT_DATE;
  const previewScope = job.data?.config.scope ?? settings.scope;
  const baseline = useBaseline(previewDate, previewScope);
  const showOutput = job.data?.status === "verified" || job.data?.status === "incomplete";
  const routes = useRoutes(jobId, previewDate, showOutput);
  const mapped = mapView === "baseline" || !showOutput ? baseline.data?.routes : routes.data?.routes;

  useEffect(() => {
    const from = job.data ?? linkedScenario;
    if (from && loaded.current !== from.id) {
      loaded.current = from.id;
      form.reset({ name: from.name, config: from.config });
      setMode(from.config.dates.length > 1 ? "batch" : "day");
      setPreset("Custom");
    }
  }, [form, job.data, linkedScenario]);

  useEffect(() => {
    if (job.data && !active(job.data.status)) void query.invalidateQueries({ queryKey: ["scenarios"] });
  }, [job.data, query]);

  const submit = useMutation({
    mutationFn: ({ kind, values }: { kind: "run" | "save"; values: FormValues }) =>
      post<Created>(kind === "run" ? "/optimization/run" : "/scenarios", values),
    onSuccess: (record, variables) => {
      void query.invalidateQueries({ queryKey: ["scenarios"] });
      if (record.job_id) {
        setMapView("shared");
        setResultDate("");
        setNotice(record.duplicate ? "An identical configuration is already in the queue. Showing that run." : "");
        router.replace(`/studio?job=${record.job_id}`, { scroll: false });
      } else if (variables.kind === "save") {
        setNotice("Configuration saved to the scenario library.");
      }
    },
  });
  const cancel = useMutation({
    mutationFn: () => post<Job>(`/optimization/jobs/${jobId}/cancel`),
    onSuccess: () => { void query.invalidateQueries({ queryKey: ["job", jobId] }); },
  });

  function selectPreset(value: Preset) {
    setPreset(value);
    if (value === "Custom") return;
    form.setValue("config", { ...defaultConfig, dates: settings.dates, ...presets[value] }, { shouldValidate: true });
  }

  function selectMode(value: "day" | "batch") {
    setMode(value);
    form.setValue("config.dates", value === "batch" ? dates.data?.map((entry) => entry.date) ?? settings.dates :
      [settings.dates[0] ?? DEFAULT_DATE], { shouldValidate: true });
    setPreset("Custom");
  }

  function numeric(name: ConfigPath, label: string, limits: { min: number; max: number; step?: number }, showError = true) {
    return <Controller name={name} control={form.control} render={({ field, fieldState }) =>
      <TextField label={label} type="number" size="small" fullWidth value={typeof field.value === "number" && Number.isFinite(field.value) ? field.value : ""}
        onBlur={field.onBlur} onChange={(event) => {
          field.onChange(event.target.value === "" ? NaN : Number(event.target.value));
          setPreset("Custom");
        }} error={Boolean(fieldState.error)} helperText={showError && fieldState.error?.message ? t(fieldState.error.message) : undefined}
        slotProps={{ htmlInput: limits }} /> } />;
  }

  const pending = active(job.data?.status);
  return <>
    <Page title={t("Optimization studio")} description={t("Configure a shared delivery plan and run the Hedyla OR-Tools solver.")}
      actions={<div className="inline studio-actions">
        <Button variant="outlined" size="small" disabled={submit.isPending} startIcon={<Save size={15} />}
          onClick={form.handleSubmit((values) => submit.mutate({ kind: "save", values }))}>{t("Save draft")}</Button>
        <Button type="submit" form="scenario-form" variant="contained" startIcon={submit.isPending ? <CircularProgress size={14} /> : <Play size={15} />}
          disabled={submit.isPending}>{t("Run optimization")}</Button>
      </div>} />
    {submit.error && <Alert severity="error" sx={{ mb: 2 }}>{t(submit.error.message)}</Alert>}
    {notice && <Alert severity="info" sx={{ mb: 2 }}>{t(notice)}</Alert>}
    <div className="studio-grid">
      <Panel title={t("Scenario configuration")} action={<SlidersHorizontal size={17} />}>
        <form id="scenario-form" noValidate onSubmit={form.handleSubmit((values) => submit.mutate({ kind: "run", values }))}>
          <div className="form-section">
            <h3><Settings2 size={15} /> {t("Planning preset")}</h3>
            <div className="form-fields pair">
              <TextField label={t("Preset")} select value={preset} onChange={(event) => selectPreset(event.target.value as Preset)} size="small">
                {Object.keys(presets).map((item) => <MenuItem key={item} value={item}>{t(item)}</MenuItem>)}
              </TextField>
              <Controller name="name" control={form.control} render={({ field, fieldState }) =>
                <TextField {...field} value={fieldState.isDirty ? field.value : scenarioLabel(field.value)} label={t("Scenario name")} size="small" error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message && t(fieldState.error.message)} />} />
            </div>
            <p className="field-help">{t(presetDescriptions[preset])}</p>
          </div>
          <div className="form-section">
            <h3><CalendarDays size={15} /> {t("Date and order scope")}</h3>
            <div className="form-fields pair">
              <TextField size="small" label={t("Planning horizon")} select value={mode}
                onChange={(event) => selectMode(event.target.value as "day" | "batch")}>
                <MenuItem value="day">{t("Single day")}</MenuItem><MenuItem value="batch" disabled={!dates.data}>{t("All dataset days")}{dates.data ? ` (${dates.data.length})` : ""}</MenuItem>
              </TextField>
              {mode === "day" ? <DateField value={settings.dates[0]} choices={dates.data} onChange={(date) => form.setValue("config.dates", [date])} /> :
                <Chip variant="outlined" label={t(`Days: ${settings.dates.length} - processed in order`, `Liczba dni: ${settings.dates.length} - po kolei`)} sx={{ alignSelf: "center" }} />}
              <Controller name="config.scope" control={form.control} render={({ field }) =>
                <TextField {...field} select label={t("Shops")} size="small" onChange={(event) => { field.onChange(event); setPreset("Custom"); }}>
                  <MenuItem value="participating">{t("Participating shops")}</MenuItem><MenuItem value="all">{t("All shops")}</MenuItem>
                </TextField>} />
              <Controller name="config.hub" control={form.control} render={({ field }) =>
                <TextField {...field} select label={t("Hub location")} size="small" onChange={(event) => { field.onChange(event); setPreset("Custom"); }}>
                  {(network.data?.nodes.filter((node) => node.kind === "shop") ?? [{ id: defaultConfig.hub, category: t("Default hub") }]).map(
                    (node) => <MenuItem value={node.id} key={node.id}>{node.id} · {categoryLabel(node.category)}</MenuItem>)}
                </TextField>} />
            </div>
            <p className="field-help">{t("Every shared tour starts and ends at the hub. In participating-shop scope, the original Hedyla routes for other shops stay outside the reported totals.")}</p>
          </div>
          <div className="form-section">
            <h3><ShieldCheck size={15} /> {t("Operating constraints")}</h3>
            <div className="form-fields pair">
              {numeric("config.max_shift_h", t("Maximum tour (h)"), { min: 4, max: 14, step: 0.5 })}
              {numeric("config.cargo_max_km", t("Cargo bike range (km)"), { min: 1, max: 150 })}
              {numeric("config.pickup_service_min", t("Pickup per order (min)"), { min: 0, max: 10, step: 0.5 })}
              {numeric("config.travel_buffer_pct", t("Travel time buffer (%)"), { min: 0, max: 100 })}
            </div>
            <p className="field-help">{t("Tour time includes driving, handling and waiting. The buffer increases matrix travel time on every planned leg.")}</p>
            <Controller name="config.priority_hard" control={form.control} render={({ field }) =>
              <TextField select label={t("High-priority deliveries")} size="small" fullWidth sx={{ mt: 1 }} value={field.value ? "hard" : "soft"}
                onChange={(event) => { field.onChange(event.target.value === "hard"); setPreset("Custom"); }}>
                <MenuItem value="hard">{t("Hard · deadline at the window midpoint")}</MenuItem>
                <MenuItem value="soft">{t("Soft · penalty after the midpoint")}</MenuItem>
              </TextField>} />
          </div>
          <div className="form-section">
            <h3><Truck size={15} /> {t("Available fleet")}</h3>
            <div className="form-fields trio">{fleetKinds.map((kind) => <div key={kind}>
              {numeric(`config.fleet.${kind}`, t(vehicleLabel[kind]), { min: 0, max: vehicles.data?.classes.find((item) => item.type === kind)?.available ?? 8 })}
            </div>)}</div>
            <p className="field-help">{t("Units available per day, drawn from the source fleet. Each vehicle can run one shared tour per day.")}</p>
            {form.formState.errors.config?.fleet?.message && <Alert severity="error" sx={{ mt: 1 }}>{t(form.formState.errors.config.fleet.message)}</Alert>}
          </div>
          <div className="form-section">
            <h3><Gauge size={15} /> {t("Objective and solver budget")}</h3>
            <div className="form-fields trio">
              {numeric("config.w_eur", t("Cost weight"), { min: 0, max: 100, step: 0.1 })}
              {numeric("config.w_co2", t("CO₂ weight"), { min: 0, max: 100, step: 0.1 })}
              {numeric("config.time_limit", t("Limit (s / day)"), { min: 1, max: 120 })}
            </div>
            <p className="field-help">{t("The objective weights each modeled euro and kilogram of CO₂e. Search limit excludes loading and validation.")}</p>
            <div className="inline" style={{ marginTop: 4 }}>
              <Button size="small" onClick={() => { form.setValue("config.time_limit", 8); setPreset("Custom"); }}>{t("Fast · 8 s")}</Button>
              <Button size="small" onClick={() => { form.setValue("config.time_limit", 30); setPreset("Custom"); }}>{t("Standard · 30 s")}</Button>
            </div>
          </div>
        </form>
      </Panel>

      <div className="stack">
        <Panel title={showOutput ? t("Run map") : t("Network preview")}
          description={`${scopeLabel(previewScope)} · ${dateLabel(previewDate)}`}
          action={<div className="inline">
            {job.data && job.data.config.dates.length > 1 && <DateField value={previewDate}
              choices={job.data.config.dates} onChange={setResultDate} label={t("Run date")} />}
            {showOutput && <ToggleButtonGroup size="small" exclusive value={mapView}
              onChange={(_, value: "baseline" | "shared" | null) => value && setMapView(value)} aria-label={t("Show routes")}>
              <ToggleButton value="baseline">{baselineName}</ToggleButton><ToggleButton value="shared">{t("Shared plan")}</ToggleButton>
            </ToggleButtonGroup>}
            {!showOutput && <span>{baselineName}</span>}
          </div>} footer={<><Legend nature={showOutput && mapView === "shared" ? "routes" : "network"} /><Schematic /></>}>
          {(mapView === "baseline" || !showOutput) && <p className="panel-body" style={{ margin: 0 }}>{baselineDefinition}</p>}
          <NetworkMap network={network.data} height={374} hub={job.data?.config.hub ?? settings.hub}
            layers={mapped ? [{ routes: mapped, baseline: mapView === "baseline" || !showOutput }] : undefined} />
        </Panel>
        <Panel title={t("Execution and validation")} description={job.data ? scenarioLabel(job.data.name) : t("Run a scenario to see solver progress and coverage.")}
          action={job.data ? <StatusChip status={job.data.status} /> : <Activity size={16} />}>
          {job.data ? <div className="panel-body stack" style={{ gap: 10 }}>
            <div className="inline muted" style={{ fontSize: 12, justifyContent: "space-between" }} aria-live="polite">
              <span className="inline">{pending && <CircularProgress size={14} />} {t(phaseLabel[job.data.phase] ?? "Unknown state")}</span>
              <Elapsed job={job.data} />
              {pending && <Button size="small" color="inherit" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{t("Cancel run")}</Button>}
            </div>
            {cancel.error && <Alert severity="error">{t(cancel.error.message)}</Alert>}
            {job.data.error && <Alert severity="error">{job.data.error}</Alert>}
            {job.data.result?.warnings.map((warning) => <Alert severity={job.data?.status === "failed" ? "error" : "warning"} key={warning}>{t(warning)}</Alert>)}
            {job.data.result?.metrics && <div>
              <div className="inline" style={{ justifyContent: "space-between", fontSize: 12, marginBottom: 9 }}>
                <strong><Coverage metrics={job.data.result.metrics.optimized} /><MetricHint label={t("order coverage")} text={metricNotes.fulfillment_pct} /></strong>
                <span className="muted">{t("Validator checks:")} {job.data.result.validation.checks.length}<MetricHint label={t("reported checks")} text={t("Number of check lines emitted by the independent constraint validator for the entire run.")} /></span>
              </div>
              {job.data.status === "verified" && <div className="three-col" style={{ gap: 8 }}>
                {anchors.map((item) => {
                  const value = job.data?.result?.metrics;
                  const delta = item.key === "fixed_eur" ? undefined : value?.changes?.[item.key];
                  return <div className="panel" style={{ padding: "9px 10px" }} key={item.key}>
                    <div className="muted" style={{ fontSize: 11 }}>{t(item.title)}<MetricHint label={t(item.title)} text={metricNotes[item.key] + (item.key === "fixed_eur" ? "" : " " + percentChange)} /></div>
                    <strong>{number(value?.optimized[item.key], item.unit === "EUR" ? 2 : 1)} <small>{item.unit}</small></strong>
                    <div className="muted" style={{ fontSize: 10 }}>{delta !== undefined && t(`${change(delta)} vs the original plan`, `${change(delta)} względem planu bazowego`)}</div>
                  </div>;
                })}
              </div>}
              <Button component={Link} href={`/routes?scenario=${job.data.scenario_id}`} endIcon={<ArrowRight size={14} />} size="small" sx={{ ml: -1, mt: 1 }}>
                {t("Inspect routes", "Zobacz trasy")}
              </Button>
            </div>}
            {job.data.result?.unserved_order_ids.length ? <details><summary style={{ fontSize: 12 }}>{t("Unserved order IDs")}</summary>
              <p className="muted" style={{ fontSize: 11, overflowWrap: "anywhere" }}>{job.data.result.unserved_order_ids.join(", ")}</p></details> : null}
            <details open={pending || job.data.status === "failed"}>
              <summary className="muted" style={{ fontSize: 12, cursor: "pointer", marginBottom: 8 }}><Terminal size={14} style={{ verticalAlign: "middle" }} /> {t("Solver log")}</summary>
              <pre className="run-log">{events.data?.events.map((event) => event.message).join("\n") || t("Waiting for the worker to emit logs.")}</pre>
            </details>
          </div> : <State loading={Boolean(jobId && job.isLoading)} error={job.error} empty={t("No run selected. The map shows the original shop routes.")} />}
        </Panel>
        <Panel title={t("Run provenance")} action={<MapPinned size={16} />}>
          <div className="panel-body muted" style={{ fontSize: 12 }}>
            <div>{t("Hedyla COM-E1 synthetic data · source distance and congestion matrices")}</div>
            <div style={{ marginTop: 6 }}>{job.data?.solver_version ?? t("OR-Tools routing · independent stop validation")}</div>
            {job.data && <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>{t("Dataset SHA-256")} {job.data.fingerprint}</div>}
          </div>
        </Panel>
        <CostNote />
      </div>
    </div>
  </>;
}
