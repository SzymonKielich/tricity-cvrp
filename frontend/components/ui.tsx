"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Chip, CircularProgress, IconButton, MenuItem, TextField, Tooltip } from "@mui/material";
import { CircleDashed, Clock3, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useVehicles } from "@/lib/api";
import { vehicleLabel } from "@/lib/scenario";
import type { DateOption, Metrics, Status } from "@/lib/types";

export function Page({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function Panel({ title, description, action, children, footer }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return <section className="panel"><div className="panel-header"><div><h2 className="panel-title">{title}</h2>
    {description && <p>{description}</p>}</div>{action}</div>{children}
    {footer && <div className="panel-footer">{footer}</div>}</section>;
}

export function State({ loading, error, empty }: { loading?: boolean; error?: Error | null; empty?: string }) {
  const { t } = useLanguage();
  if (loading) return <div className="status-state"><CircularProgress size={22} aria-label={t("Loading")} /></div>;
  if (error) return <Alert severity="error">{t(error.message)}</Alert>;
  return <div className="status-state">{empty ?? t("No records to display.")}</div>;
}

export function StatusChip({ status }: { status?: Status | null }) {
  const { t } = useLanguage();
  if (status === "verified") return null;
  const labels: Record<Exclude<Status, "verified">, string> = { queued: t("Queued"), running: t("Running"),
    incomplete: t("Incomplete"), failed: t("Failed"), cancelled: t("Cancelled"), unverified: t("Simulated schedule") };
  const color = status === "failed" ? "error" :
    status === "incomplete" ? "warning" : status === "running" ? "info" : "default";
  return <Chip label={status ? labels[status] : t("Draft")} size="small" color={color} variant="outlined"
    icon={status === "queued" ? <Clock3 size={13} /> :
      status === "running" ? <CircleDashed size={13} /> : undefined} />;
}

export function DateField({ value, choices, onChange, label = "Dataset date" }: {
  value: string; choices?: DateOption[] | string[]; onChange: (value: string) => void; label?: string;
}) {
  const { t, dateLabel } = useLanguage();
  const dates = choices?.map((date) => typeof date === "string" ? date : date.date) ?? [value];
  return <TextField select label={t(label)} value={dates.includes(value) ? value : dates[0] ?? ""} size="small"
    onChange={(event) => onChange(event.target.value)} sx={{ minWidth: 145 }}>
    {dates.map((date) => <MenuItem value={date} key={date}>{dateLabel(date)}</MenuItem>)}
  </TextField>;
}

export const metricRows: { key: Exclude<keyof Metrics, "fleet">; title: string; unit: string; precision?: number }[] = [
  { key: "km", title: "Distance", unit: "km", precision: 1 },
  { key: "co2_kg", title: "Emissions", unit: "kg CO₂e", precision: 1 },
  { key: "cost_eur", title: "Modeled total cost", unit: "€", precision: 2 },
  { key: "variable_eur", title: "Variable transport cost", unit: "€", precision: 2 },
  { key: "fixed_eur", title: "Fixed charges", unit: "€", precision: 2 },
  { key: "cost_per_order_eur", title: "Cost per fulfilled order", unit: "€", precision: 2 },
  { key: "fulfillment_pct", title: "Coverage", unit: "%", precision: 1 },
  { key: "delivery_on_time_pct", title: "Delivery punctuality (planned / simulated)", unit: "%", precision: 1 },
  { key: "pickup_on_time_pct", title: "Pickup punctuality", unit: "%", precision: 1 },
  { key: "weight_utilization_pct", title: "Load utilization by weight", unit: "%", precision: 1 },
  { key: "volume_utilization_pct", title: "Load utilization by volume", unit: "%", precision: 1 },
  { key: "vehicle_hours", title: "Tour hours (planned / simulated)", unit: "h", precision: 1 },
  { key: "waiting_hours", title: "Waiting", unit: "h", precision: 1 },
  { key: "empty_km", title: "Empty distance", unit: "km", precision: 1 },
  { key: "grouped_orders", title: "Orders on multi-shop tours", unit: "" },
  { key: "routes", title: "Tours", unit: "" },
];

export function metricValue(value: number | null, unit: string, precision: number | undefined, number: ReturnType<typeof useLanguage>["number"]) {
  if (value === null) return "-";
  return unit === "€" ? `€${number(value, precision)}` : `${number(value, precision)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

export function MetricHint({ label, text }: { label: string; text: string }) {
  const { t } = useLanguage();
  return <Tooltip title={text} describeChild enterTouchDelay={0}>
    <IconButton size="small" aria-label={t(`Calculation for ${label}`, `Jak obliczamy: ${label}`)} sx={{ ml: 0.25, p: 0.5, verticalAlign: "middle" }}>
      <Info size={13} />
    </IconButton>
  </Tooltip>;
}

export function Coverage({ metrics }: { metrics: Metrics }) {
  const { t } = useLanguage();
  return <>{t(`${metrics.delivered} of ${metrics.requested} orders`, `${metrics.delivered} z ${metrics.requested} zamówień`)}</>;
}

export function CostNote() {
  const { t, number } = useLanguage();
  const fleet = useVehicles();
  return <Alert severity="info" variant="outlined" icon={false} sx={{ fontSize: 12 }}>
    <p style={{ marginTop: 0 }}><strong>{t("Variable cost")}</strong> {t("= tour distance from the Hedyla matrix × vehicle rate in EUR/km.")} {" "}<strong>{t("Fixed cost")}</strong> {t("= the rate charged once per shop route in the original plan and once per vehicle used per day in the shared plan. OR-Tools allows one tour per vehicle per day.")}</p>
    <p>{t("Rates from")} <code>hedyla_vehicles.csv</code>{fleet.data && ": "}{fleet.data?.classes.map((vehicle) =>
      t(`${t(vehicleLabel[vehicle.type])} €${number(vehicle.cost_eur_per_km, 2)}/km + €${number(vehicle.fixed_shift_cost_eur, 2)} fixed`, `${t(vehicleLabel[vehicle.type])} €${number(vehicle.cost_eur_per_km, 2)}/km + €${number(vehicle.fixed_shift_cost_eur, 2)} opłaty stałej`)
    ).join(" · ")}.</p>
    <p style={{ marginBottom: 0 }}>{t("Differences are estimates under this transport cost model. It excludes coordination and handling overhead.")}</p>
  </Alert>;
}
